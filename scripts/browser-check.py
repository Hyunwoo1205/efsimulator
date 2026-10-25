"""선택적 실제 브라우저 검증. Python Playwright와 Chromium이 설치된 환경에서 실행한다.

npm run build && npm run preview -- --port 4173
python scripts/browser-check.py --url http://127.0.0.1:4173
"""

import argparse
import asyncio
import json
import os
import re
import shutil
import unicodedata
from pathlib import Path
from urllib.parse import quote, urlparse

from playwright.async_api import async_playwright, expect


SCOPE_NOTE = "감독 정보는 서비스 지원 범위에서 제외합니다. 실제 상품에 감독이 없다는 뜻은 아닙니다."


def entity_path(kind, entity):
    return f"/{kind}/{quote(entity['id'], safe='')}"


def has_external_id(entity, value):
    return any(item["value"] == value for item in entity["external_ids"])


def related_products(catalog, identifier):
    return [product for product in catalog["products"] if any(
        entry["kind"] == "card" and entry["target_id"] == identifier
        for entry in product["entries"]
    )]


def normalized(value):
    return "".join(character for character in unicodedata.normalize("NFKD", value)
                   if unicodedata.category(character) != "Mn").lower()


def type_label(kind):
    labels = {"normal": "Standard", "featured": "Featured", "trending": "Trend",
              "legend": "Legend", "epic": "Epic", "highlight": "Highlight",
              "bigtime": "Big Time", "showtime": "Show Time"}
    return labels.get(kind["label"].lower(), kind["label"])


async def assert_supported_scope(page):
    await expect(page.locator('.main-nav [data-tab="managers"]')).to_have_count(0)
    await expect(page.locator('.catalog-tabs a[href*="managers"]')).to_have_count(0)
    await expect(page.locator('.manager-tile, .manager-detail')).to_have_count(0)
    assert not re.search(r"감독\s*0\s*명?", await page.locator("body").inner_text())
    await expect(page.get_by_text("전체 구성 확인", exact=True)).to_have_count(0)
    await expect(page.get_by_text("출처 근거로 전체 구성을 확인했습니다.", exact=True)).to_have_count(0)


async def check(args):
    output = Path(args.artifacts).resolve()
    output.mkdir(parents=True, exist_ok=True)
    executable = shutil.which("chromium") or shutil.which("google-chrome")
    options = {"headless": True}
    if executable:
        options["executable_path"] = executable
    # Preserve the session proxy for external images/fonts; localhost is local.
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        options["proxy"] = {"server": proxy, "bypass": "127.0.0.1,localhost"}
    base = args.url.rstrip("/")
    if urlparse(base).hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("이 검사는 로컬 미리보기 URL에서만 실행합니다.")
    results = []
    errors = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(**options)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
        response = await context.request.get(f"{base}/data/catalog.json")
        assert response.ok, f"catalog HTTP {response.status}"
        catalog = await response.json()
        counts = {key: len(catalog[key]) for key in ["products", "cards"]}
        assert catalog["managers"] == [], "활성 감독 목록은 지원 범위에서 제외해야 합니다."
        assert catalog["coverage"]["manager_support"] == "excluded_bulk_api_unavailable"
        assert all(entry["kind"] != "manager" for product in catalog["products"] for entry in product["entries"])
        assert all(product["composition_status"] != "complete" for product in catalog["products"])
        magical = next(product for product in catalog["products"]
                       if has_external_id(product, "magical-dribblers-22-oct-26"))
        magical_cards = [entry for entry in magical["entries"] if entry["kind"] == "card"]
        yaya = next(card for card in catalog["cards"] if has_external_id(card, "88046292727298"))
        yaya_search_count = sum("yaya" in normalized(" ".join([
            card["name"], *(item["value"] for item in card["external_ids"])
        ])) for card in catalog["cards"])
        highlight_count = sum(any(type_label(kind) == "Highlight" for kind in card["types"])
                              for card in catalog["cards"])

        page = await context.new_page()
        await page.goto(base, wait_until="domcontentloaded")
        await expect(page.locator("#app")).to_have_attribute("aria-busy", "false")
        await expect(page.locator(".product-tile")).to_have_count(counts["products"])
        await expect(page.locator(".coverage-label")).to_have_text("조사 표본 공개")
        await expect(page.locator(".service-scope-note")).to_have_text(SCOPE_NOTE)
        await assert_supported_scope(page)
        if catalog["coverage"].get("card_api_audit", {}).get("status") == "blocked":
            await expect(page.locator(".api-audit-note")).to_contain_text("접근 차단으로 미완료")
        await page.screenshot(path=str(output / "preview-desktop.png"), full_page=True)
        results.append("데스크톱 홈·실제 상품 수·감독 지원 범위 제외·전수 검증 미완료 표시")

        for product in catalog["products"]:
            await page.goto(f'{base}{entity_path("products", product)}', wait_until="domcontentloaded")
            await expect(page.locator("h1")).to_have_text(product["name"])
            await expect(page.locator(".service-scope-note")).to_have_text(SCOPE_NOTE)
            await expect(page.locator(".product-detail-heading .badge-row")).to_contain_text("전체 구성 미확인")
            await expect(page.locator(".composition-note")).to_contain_text("전체 구성이 아닐 수")
            await assert_supported_scope(page)
            expected_cards = sum(entry["kind"] == "card" for entry in product["entries"])
            await expect(page.locator(".player-tile")).to_have_count(expected_cards)
            if product["kind"] == "pack" or product.get("purchase_mode") == "bundle":
                await expect(page.locator(".bundle-note")).to_contain_text("구매 시 확인된 구성품을 일괄 지급")
                await expect(page.locator(".bundle-note")).to_contain_text("코인으로 결제해도 향후 개봉 시뮬레이터 대상에서 제외")
            else:
                await expect(page.locator(".bundle-note")).to_have_count(0)
        results.append("모든 상품의 카드 수·감독 지원 범위·전체 구성 미확인·팩 정의 검증")

        await page.goto(f'{base}{entity_path("products", magical)}', wait_until="domcontentloaded")
        await expect(page.locator(".player-tile")).to_have_count(len(magical_cards))
        await expect(page.locator(".facts-grid")).to_contain_text("미확인")
        product_url = page.url
        await page.reload(wait_until="domcontentloaded")
        await expect(page.locator(".player-tile")).to_have_count(len(magical_cards))
        first_card_id = magical_cards[0]["target_id"]
        await page.locator(f'.player-tile h3 a[href="/cards/{quote(first_card_id, safe="")}"]').click()
        await expect(page.locator(".overall-block")).to_contain_text("능력치 적용 조건은 미확인")
        await expect(page.locator(".product-tile")).to_have_count(len(related_products(catalog, first_card_id)))
        await page.locator(f'.product-tile h3 a[href="{entity_path("products", magical)}"]').click()
        assert page.url == product_url
        await page.go_back()
        await expect(page.locator(".overall-block")).to_be_visible()
        results.append("Magical 상품↔카드 이동·직접 주소 새로고침·뒤로 이동·미확인 표시")

        await page.goto(f"{base}/?tab=cards&q=Yaya", wait_until="domcontentloaded")
        await expect(page.locator(".player-tile")).to_have_count(yaya_search_count)
        await page.locator(f'.player-tile h3 a[href="{entity_path("cards", yaya)}"]').click()
        await expect(page.locator(".player-tile")).to_have_count(len(yaya["other_version_ids"]))
        await expect(page.locator(".external-id code").first).to_have_text("88046292727298")
        await expect(page.locator(".evidence-item")).not_to_have_count(0)
        await page.goto(f"{base}/cards", wait_until="domcontentloaded")
        await page.locator("#catalog-type").select_option(label="Highlight")
        await expect(page.locator(".player-tile")).to_have_count(highlight_count)
        await page.locator("#catalog-search").fill("존재하지않는선수_검증")
        await page.locator(".search-form button").click()
        await expect(page.locator(".empty-state")).to_be_visible()
        await expect(page.locator("[role=alert]")).to_have_count(0)
        results.append("카드 검색·분류별 실제 수량·다른 버전·원본 ID·빈 결과 구분")

        for width, height in [(768, 1024), (390, 844), (320, 740)]:
            await page.set_viewport_size({"width": width, "height": height})
            for path in ["", entity_path("products", magical)]:
                await page.goto(f"{base}{path}", wait_until="domcontentloaded")
                await expect(page.locator("#app")).to_have_attribute("aria-busy", "false")
                assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth"), f"가로 넘침: {width}px {path}"
                await assert_supported_scope(page)
            await page.goto(base, wait_until="domcontentloaded")
            await expect(page.locator(".product-tile")).to_have_count(counts["products"])
            if width == 390:
                await page.screenshot(path=str(output / "preview-mobile.png"), full_page=True)
        results.append("홈·상품 상세의 태블릿/모바일 768·390·320px 가로 넘침 없음")

        failed = await context.new_page()
        await failed.route("**/data/catalog.json", lambda route: route.fulfill(status=503, body="unavailable"))
        await failed.goto(base, wait_until="domcontentloaded")
        await expect(failed.locator("[role=alert]")).to_contain_text("자료를 불러오지 못했습니다")
        await failed.unroute("**/data/catalog.json")
        await failed.get_by_role("button", name="다시 불러오기").click()
        await expect(failed.locator(".product-tile")).to_have_count(counts["products"])
        results.append("자료 조회 실패·재시도 복구")

        image_failure = await context.new_page()
        await image_failure.route("https://efimg.com/**", lambda route: route.abort())
        await image_failure.goto(base, wait_until="domcontentloaded")
        await expect(image_failure.locator(".product-tile")).to_have_count(counts["products"])
        await expect(image_failure.locator(".image-fallback").first).to_be_visible()
        results.append("이미지 실패 대체 표시")

        assert not errors, errors
        await browser.close()
    report = {"url": base, "catalog_counts": counts, "manager_support": catalog["coverage"]["manager_support"], "passed": results, "page_errors": errors}
    (output / "browser-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="efsimulator 실제 표본 브라우저 검증")
    parser.add_argument("--url", default="http://127.0.0.1:4173")
    parser.add_argument("--artifacts", default="artifacts")
    asyncio.run(check(parser.parse_args()))
