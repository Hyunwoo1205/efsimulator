"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { dateOnly, dateTime, normalize, packPath, packTitle, simulatorPath, useCatalog, type Pack } from "./catalog-data";
import { Breadcrumb, DataBoundary, EmptyState, PackArtwork, PackCard, PlayerCard, Portrait, RefreshButton } from "./catalog-ui";
import { drawCostLabel, readDrawOptions } from "../../lib/draw-options.mjs";
import { StandardCard } from "./standard-card";
import { prepareSimulatorPack } from "../../lib/simulator/prepare.mjs";

function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (value: string) => void; label: string; placeholder: string }) {
  return <label className="search"><span className="visually-hidden">{label}</span><span aria-hidden="true">⌕</span><input type="search" value={value} maxLength={200} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>;
}

function PackCounts({ pack }: { pack: Pack }) {
  return <dl className="pack-summary-counts"><div><dt>전체 선수 <small>N</small></dt><dd>{pack.totalPlayerCount}<span>명</span></dd></div><div><dt>특수 선수 <small>S</small></dt><dd>{pack.playerCount}<span>명</span></dd></div><div><dt>일반 선수 <small>A</small></dt><dd>{pack.standardPlayerCount}<span>명</span></dd></div></dl>;
}

function PackDrawOptions({ pack, actions = false }: { pack: Pack; actions?: boolean }) {
  const options = readDrawOptions(pack);
  if (!options) return <p className="draw-options-unknown" role="status">추첨 방식과 비용을 확인하고 있습니다.</p>;
  const modes = [options.single, options.ten];
  return <div className="draw-options" aria-label="이 선수팩의 추첨 방식"><dl>{modes.map(mode => <div key={mode.count}><dt>{mode.count}회 뽑기</dt><dd>{mode.supported ? drawCostLabel(mode.coinCost) : "미지원"}</dd></div>)}</dl>{options.ten.supported && <p>10회 뽑기는 잔여 선수가 10명 이상일 때 이용할 수 있습니다.</p>}{actions && <div className="draw-option-actions">{modes.filter(mode => mode.supported).map(mode => <button className="primary-button" key={mode.count} type="button" disabled aria-describedby="simulator-notice">{mode.count}회 뽑기</button>)}</div>}</div>;
}

function SourceNote() {
  return <aside className="source-note"><span>카드부터 명단까지.</span><p>구성을 확인한 선수팩과 선수 카드를 제공합니다. 판매 상태와 종료 시각은 한국시간 기준입니다.</p><a href="https://efootball-web.konami.net/probability_kr.php" target="_blank" rel="noopener noreferrer">공식 확률표 보기 ↗</a></aside>;
}

function PackCollection({ packs, ended, expanded, onExpanded }: { packs: Pack[]; ended: boolean; expanded: string | null; onExpanded: (saleId: string | null) => void }) {
  const collectionRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const element = collectionRef.current;
    if (!element) return;
    const updateColumns = () => {
      const count = Number.parseInt(getComputedStyle(element).getPropertyValue("--pack-columns"), 10);
      if (Number.isSafeInteger(count) && count > 0) setColumns(count);
    };
    updateColumns();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateColumns);
    observer?.observe(element);
    window.addEventListener("resize", updateColumns);
    return () => { observer?.disconnect(); window.removeEventListener("resize", updateColumns); };
  }, []);
  const rows = Array.from({ length: Math.ceil(packs.length / columns) }, (_, row) => packs.slice(row * columns, (row + 1) * columns));
  return <div ref={collectionRef} className="pack-collection">{rows.map((row, rowIndex) => {
    const selected = row.find(pack => pack.saleId === expanded);
    const rosterId = selected ? `roster-${encodeURIComponent(selected.saleId)}` : "";
    return <div className="pack-row" key={row[0].saleId}><div className="packs-grid">{row.map((pack, columnIndex) => {
      const isExpanded = pack.saleId === expanded;
      return <div className="pack-entry" key={pack.saleId} data-expanded={isExpanded}><PackCard pack={pack} ended={ended} index={rowIndex * columns + columnIndex} /><button id={`roster-toggle-${encodeURIComponent(pack.saleId)}`} type="button" className="roster-toggle" aria-expanded={isExpanded} aria-controls={`roster-${encodeURIComponent(pack.saleId)}`} onClick={() => onExpanded(isExpanded ? null : pack.saleId)}>{isExpanded ? "명단 접기" : "선수 명단 펼쳐보기"}<span aria-hidden="true">{isExpanded ? "−" : "+"}</span></button></div>;
    })}</div>{selected && <section id={rosterId} className="inline-roster" aria-labelledby={`${rosterId}-heading`}><div className="inline-roster-heading"><div><h3 id={`${rosterId}-heading`}>{packTitle(selected)}</h3><p>특수 선수 {selected.playerCount}명</p></div><button type="button" className="inline-roster-close" aria-label={`${packTitle(selected)} 명단 접기`} onClick={() => { onExpanded(null); document.getElementById(`roster-toggle-${encodeURIComponent(selected.saleId)}`)?.focus(); }}>명단 접기 <span aria-hidden="true">−</span></button></div><div className="inline-roster-grid">{selected.players.map(player => <PlayerCard key={player.id} player={player} />)}</div>{selected.standardPlayerCount > 0 && <p className="inline-standard">일반 선수 {selected.standardPlayerCount}명은 인원수로 표시합니다.</p>}<a className="text-button" href={packPath(selected.saleId)}>팩 상세 보기 ↗</a></section>}</div>;
  })}</div>;
}

export function PacksPage() {
  const { catalog, live, archive } = useCatalog();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"live" | "archive">("live"); const [query, setQuery] = useState("");
  const packs = filter === "live" ? live : archive;
  const matched = useMemo(() => packs.filter(pack => normalize([packTitle(pack), pack.name, ...pack.players.map(player => player.name)].join(" ")).includes(normalize(query.trim()))), [packs, query]);
  return <>
    <section className="hero"><div className="hero-copy"><p className="eyebrow">EFOOTBALL / PLAYER COLLECTIONS</p><h1>한 장의 카드에서,<br /><span>하나의 명단까지.</span></h1><p className="hero-description">판매 중인 선수팩과 지난 명단을 둘러보세요.<br />어떤 선수가 있는지, 전체 구성은 어떤지 한눈에.</p></div><div className="hero-symbol" aria-hidden="true"><span className="orbit" /><span className="center-circle" /><span className="hero-number logo-number">ef.</span><span className="hero-symbol-caption">FIND YOUR PLAYERS.<br />BUILD YOUR COLLECTION.</span></div></section>
    <section className="overview" aria-label="현재 자료 현황"><div><span>판매 중인 팩</span><strong>{catalog ? live.length : "—"}<small>팩</small></strong></div><div><span>판매 종료 기록</span><strong>{catalog ? archive.length : "—"}<small>팩</small></strong></div><div><span>연결된 선수 카드</span><strong>{catalog?.players.length ?? "—"}<small>장</small></strong></div><div className="updated"><span>마지막 자료 갱신</span><p>{catalog ? dateTime(catalog.manifest.created_at) : "자료 확인 중"}<small>한국시간 기준</small></p></div></section>
    <section className="catalog content-section"><div className="section-heading"><div><p className="eyebrow">EXPLORE THE COLLECTION</p><h2>선수팩을 살펴보세요.</h2></div><RefreshButton /></div><div className="catalog-toolbar"><div className="tabs" aria-label="선수팩 상태"><button type="button" aria-pressed={filter === "live"} onClick={() => setFilter("live")}>판매 중인 팩<span>{catalog ? live.length : "—"}</span></button><button type="button" aria-pressed={filter === "archive"} onClick={() => setFilter("archive")}>판매 종료<span>{catalog ? archive.length : "—"}</span></button></div><SearchField value={query} onChange={setQuery} label="선수팩 또는 포함된 선수 검색" placeholder="팩 이름 · 포함된 선수 검색" /></div><DataBoundary><div className="results-summary" role="status"><p>{query.trim() ? `“${query.trim()}” 검색 결과` : filter === "live" ? "판매 중인 선수팩" : "판매 종료된 선수팩"}<strong>{matched.length}팩</strong></p><span>Epic → Show Time → Trend → Highlight · 등급별 최신순</span></div>{matched.length ? <PackCollection packs={matched} ended={filter === "archive"} expanded={expanded} onExpanded={setExpanded} /> : <EmptyState title={query ? "일치하는 선수팩이 없습니다." : filter === "archive" ? "아직 종료된 명단이 없습니다." : "현재 판매 중인 선수팩이 없습니다."} description={query ? "다른 팩 이름이나 선수 이름으로 검색해 보세요." : "확인된 선수팩이 추가되면 이곳에 표시됩니다."} />}</DataBoundary></section><SourceNote />
  </>;
}

export function PlayersPage() {
  const { catalog } = useCatalog(); const [query, setQuery] = useState(""); const [position, setPosition] = useState("");
  const positions = useMemo(() => [...new Set((catalog?.players ?? []).map(player => player.position).filter((value): value is string => Boolean(value)))].sort(), [catalog]);
  const players = useMemo(() => (catalog?.players ?? []).filter(player => (!position || player.position === position) && normalize(`${player.name} ${player.id} ${player.position ?? ""}`).includes(normalize(query.trim()))), [catalog, query, position]);
  return <><section className="page-intro"><p className="eyebrow">PLAYER CARDS</p><h1>선수 카드,<br /><span>가까이서 살펴보기.</span></h1><p>포지션과 플레이 스타일부터 선수가 포함된 팩까지 확인하세요.</p></section><section className="content-section"><div className="section-heading"><div><p className="eyebrow">FIND YOUR PLAYER</p><h2>누구를 찾고 있나요?</h2></div><RefreshButton /></div><div className="player-toolbar"><SearchField value={query} onChange={setQuery} label="선수 이름 또는 카드 번호 검색" placeholder="선수 이름 · 카드 번호 검색" /><label className="position-filter"><span className="visually-hidden">포지션 선택</span><select value={position} onChange={event => setPosition(event.target.value)}><option value="">모든 포지션</option>{positions.map(value => <option value={value} key={value}>{value}</option>)}</select></label></div><DataBoundary><div className="results-summary" role="status"><p>{query.trim() ? `“${query.trim()}” 검색 결과` : "팩에 연결된 선수 카드"}<strong>{players.length}장</strong></p><span>Epic → Show Time → Trend → Highlight · 등급별 최신순 → 오버롤순</span></div>{players.length ? <div className="players-grid">{players.map(player => <PlayerCard player={player} key={player.id} />)}</div> : <EmptyState title="일치하는 선수가 없습니다." description="다른 선수 이름으로 검색하거나 포지션을 바꿔 보세요." />}</DataBoundary></section><SourceNote /></>;
}

export function PackDetailPage({ saleId }: { saleId: string }) {
  const { allPacks, live } = useCatalog(); const pack = allPacks.find(item => item.saleId === saleId); const active = live.some(item => item.saleId === saleId);
  return <><Breadcrumb items={[{ href: "/packs", title: "선수팩" }, { title: pack ? packTitle(pack) : "선수팩 상세" }]} /><DataBoundary>{!pack ? <EmptyState title="선수팩을 찾을 수 없습니다." description="주소를 확인하거나 선수팩 목록에서 다시 선택해 주세요." href="/packs" /> : <>
    <section className="pack-detail-hero"><div className="detail-pack-art"><span className={`pack-status${active ? "" : " ended"}`}>{active ? "판매 중" : "판매 종료"}</span><PackArtwork pack={pack} /><span className="detail-art-label">THE FULL COLLECTION</span></div><div className="detail-pack-copy"><p className="eyebrow">PLAYER COLLECTION</p><h1>{packTitle(pack)}</h1><p className="detail-secondary-name">{pack.name !== packTitle(pack) ? pack.name : "구성을 확인한 선수팩"}</p><dl className="pack-dates"><div><dt>출시일</dt><dd>{dateOnly(pack.date)}</dd></div><div><dt>{active ? "판매 종료 예정" : "판매 종료"}</dt><dd>{dateTime(pack.endsAt)}</dd></div></dl><PackDrawOptions pack={pack} />{!active && <p className="ended-message">판매가 종료된 선수팩입니다. 체험 목록에서 구성을 확인할 수 있습니다.</p>}<a className="primary-button action-link" href={simulatorPath(pack.saleId)}>{active ? "시뮬레이터에서 이 팩 보기" : "판매 종료 팩 체험에서 보기"} <span aria-hidden="true">↗</span></a></div></section>
    <PackCounts pack={pack} /><section className="content-section"><div className="section-heading"><div><p className="eyebrow">THE SPECIAL LINEUP</p><h2>이 팩의 선수들.</h2></div><span className="section-total">특수 선수 {pack.playerCount}명</span></div><div className="players-grid">{pack.players.map(player => <PlayerCard key={player.id} player={player} />)}</div>{pack.standardPlayerCount > 0 && <div className="standard-note"><span>일반 선수 {pack.standardPlayerCount}명</span><p>일반 선수는 전체 구성의 인원수로 표시합니다. 개별 카드 목록은 제공하지 않습니다.</p></div>}</section><SourceNote />
  </>}</DataBoundary></>;
}

export function PlayerDetailPage({ id }: { id: string }) {
  const { catalog, allPacks, live } = useCatalog(); const player = catalog?.players.find(item => item.id === id); const packs = allPacks.filter(pack => pack.players.some(member => member.id === id)); const liveIds = new Set(live.map(pack => pack.saleId));
  return <><Breadcrumb items={[{ href: "/players", title: "선수" }, { title: player?.name ?? "선수 상세" }]} /><DataBoundary>{!player ? <EmptyState title="선수 카드를 찾을 수 없습니다." description="주소를 확인하거나 선수 목록에서 다시 선택해 주세요." href="/players" /> : <>
    <section className="player-detail-hero"><div className="player-detail-art"><Portrait player={player} featured /></div><div className="player-detail-copy"><p className="eyebrow">PLAYER PROFILE</p><div className="player-detail-position">{player.position ?? "포지션 미확인"}</div><h1>{player.name}</h1><div className="detail-rating"><span>표시 OVR</span><strong>{player.overallRating ?? "—"}</strong></div><dl className="player-facts"><div><dt>플레이 스타일</dt><dd>{player.playingStyle ?? "미확인"}</dd></div><div><dt>수비 플레이 스타일</dt><dd>{player.playingStyleDefensive ?? "미확인"}</dd></div><div><dt>카드 번호</dt><dd className="player-card-id">{player.id}</dd></div></dl></div></section><section className="content-section"><div className="section-heading"><div><p className="eyebrow">PART OF THE COLLECTION</p><h2>이 선수가 포함된 팩.</h2></div><span className="section-total">{packs.length}팩</span></div>{packs.length ? <div className="packs-grid">{packs.map((pack, index) => <PackCard pack={pack} key={pack.saleId} ended={!liveIds.has(pack.saleId)} index={index} />)}</div> : <EmptyState title="연결된 선수팩을 확인 중입니다." description="선수팩 목록에서 다른 명단도 살펴보세요." href="/packs" />}</section><SourceNote />
  </>}</DataBoundary></>;
}

export function SimulatorPage() {
  const { catalog, allPacks, live, archive, loading, error } = useCatalog(); const searchParams = useSearchParams(); const chosenId = searchParams.get("pack") ?? ""; const pack = allPacks.find(item => item.saleId === chosenId); const active = live.some(item => item.saleId === chosenId); const preparation = prepareSimulatorPack({ saleId: chosenId, catalog, loading, error });
  const groups = [{ key: "live", title: "판매 중인 선수팩", packs: live }, { key: "archive", title: "판매 종료 팩 체험", packs: archive }];
  return <><section className="page-intro simulator-intro"><p className="eyebrow">PACK OPENING SIMULATOR</p><h1>다음 컬렉션을<br /><span>미리 만나보세요.</span></h1><p>선수팩을 선택하고 구성을 살펴보세요. 추첨 기능을 준비하고 있습니다.</p><span className="coming-soon-pill"><i />추첨 준비 중</span></section><DataBoundary><section className="simulator-layout"><aside className="simulator-picker"><div className="section-heading"><div><p className="eyebrow">CHOOSE A COLLECTION</p><h2>선수팩 선택</h2></div></div>{groups.map(group => <section className={`simulator-pack-group ${group.key}`} key={group.key} aria-labelledby={`simulator-${group.key}-label`}><label id={`simulator-${group.key}-label`} htmlFor={`simulator-pack-${group.key}`}>{group.title}<span>{group.packs.length}팩</span></label><select id={`simulator-pack-${group.key}`} value={group.packs.some(item => item.saleId === chosenId) ? chosenId : ""} onChange={event => window.location.assign(event.target.value ? simulatorPath(event.target.value) : "/simulator")}><option value="">{group.title} 선택</option>{group.packs.map(item => <option key={item.saleId} value={item.saleId}>{packTitle(item)}</option>)}</select>{group.key === "archive" && <p className="picker-note">판매가 종료된 팩을 구분해 살펴보는 체험 목록입니다.</p>}</section>)}<div className="simulator-status"><span className="status-outline-mark" aria-hidden="true">◎</span><strong>추첨 기능을 준비 중입니다.</strong><p>지금은 선수팩 선택과 구성·추첨 방식 확인을 이용할 수 있습니다.</p></div><a className="back-to-packs" href="/packs">모든 선수팩 살펴보기 <span aria-hidden="true">↗</span></a></aside><div className="simulator-preview">{!chosenId ? <div className="simulator-welcome"><span className="simulator-welcome-mark" aria-hidden="true">ef.</span><p className="eyebrow">YOUR NEXT COLLECTION</p><h2>어떤 선수팩이 궁금한가요?</h2><p>판매 중 또는 판매 종료 체험 목록에서 선수팩을 선택하세요.</p></div> : !pack ? <EmptyState title="선수팩을 찾을 수 없습니다." description="목록에서 다른 팩을 선택해 주세요." /> : <div className="simulator-selected"><div className="simulator-selected-top"><div><p className="eyebrow">{active ? "SELECTED COLLECTION" : "ARCHIVE EXPERIENCE"}</p><h2>{packTitle(pack)}</h2><p className="simulator-deadline">{active ? "판매 종료 예정" : "판매 종료 팩 체험"} · {dateTime(pack.endsAt)}</p></div><div className="simulator-selected-art"><PackArtwork pack={pack} /></div></div><PackCounts pack={pack} /><p className={`simulator-preparation ${preparation.ready ? "verified" : "pending"}`} role="status">{preparation.ready ? "선수팩 구성을 확인했습니다." : loading ? "선수팩 구성을 확인하고 있습니다." : "선수팩 구성을 다시 확인해 주세요."}</p>{!active && <div className="ended-warning" role="status">판매 종료 팩 체험 · 현재 판매 중인 상품과 구분되는 과거 명단입니다.</div>}<div className="simulator-action"><PackDrawOptions pack={pack} actions /><p id="simulator-notice">추첨 기능을 준비 중입니다. 지원하는 추첨 방식만 표시하며, 현재 버튼은 비활성 상태입니다.</p></div><div className="simulator-roster-heading"><h3>이 팩의 특수 선수</h3><a href={packPath(pack.saleId)}>팩 상세 보기 ↗</a></div><div className="simulator-roster-grid">{pack.players.map(player => <PlayerCard player={player} key={player.id} />)}</div>{pack.standardPlayerCount > 0 && <div className="simulator-standard-preview"><StandardCard /><div><h3>일반 선수 {pack.standardPlayerCount}명</h3><p>추첨 시 일반 슬롯에 사용할 공통 카드입니다. 이름과 오버롤 없이 표시합니다.</p></div></div>}</div>}</div></section></DataBoundary><SourceNote /></>;
}
