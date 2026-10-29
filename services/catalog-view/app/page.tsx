"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { selectPackPreview } from "../lib/pack-preview.mjs";
import { orderCatalog, playerGrade } from "../lib/catalog-order.mjs";
import { createCatalogRefresh, projectCatalogSales } from "../lib/catalog-refresh.mjs";

type Player = { playerType?: number; id: string; name: string; slug: string; position: string | null; overallRating: number | null; playingStyle: string | null; playingStyleDefensive: string | null; imageUrl: string | null };
type Pack = { saleId: string; name: string; officialTitle: string; playerCount: number; totalPlayerCount: number; standardPlayerCount: number; date: string | null; endsAt: string; players: Player[] };
type Manifest = { version_id: string; created_at: string | null };
type Catalog = { manifest: Manifest; live: Pack[]; archive: Pack[]; players: Player[] };
type Tab = "live" | "archive" | "players";
type ApiBody = { data?: unknown; error?: { message?: string }; meta?: { catalog_snapshot_id?: string }; pagination?: { next_cursor?: string | null } };

const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(new Date(value)) : "미확인";
const dateOnly = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미확인";
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("ko-KR");
const tabLabels: Record<Tab, string> = { live: "판매 중인 팩", archive: "판매 종료", players: "선수 카드" };

async function read(path: string, signal: AbortSignal) {
  const response = await fetch(`/api/v1/${path}`, { signal, headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("데이터 연결을 확인할 수 없습니다. 다시 로그인한 뒤 시도해 주세요.");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("데이터 응답을 확인할 수 없습니다.");
  const body = value as ApiBody;
  if (!response.ok) throw new Error(body.error?.message ?? "데이터를 불러오지 못했습니다.");
  return body;
}

function Portrait({ player, small = false }: { player: Player; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  let image: string | null = null;
  try { const url = new URL(player.imageUrl ?? ""); if (url.protocol === "https:" && url.hostname === "efimg.com") image = url.href; } catch { /* Optional image. */ }
  return <div className={small ? "portrait small" : "portrait"}>
    <span aria-hidden="true" className="portrait-fallback">ef<span>.</span></span>
    {image && !failed && <img src={image} alt={`${player.name} 카드`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </div>;
}

function PlayerTile({ player, small = false }: { player: Player; small?: boolean }) {
  return <article className={small ? "player-tile compact" : "player-tile"}>
    <Portrait player={player} small={small} />
    <div className="player-content"><div className="player-topline"><span className="position">{player.position ?? "포지션 미확인"}</span><span className="rating"><span>OVR</span> {player.overallRating ?? "—"}</span></div>
      <h3>{player.name}</h3><span className="card-grade">{playerGrade(player).label}</span><p className="play-style">{player.playingStyle ?? player.playingStyleDefensive ?? "플레이 스타일 미확인"}</p><span className="card-id">{player.id}</span>
    </div>
  </article>;
}

export default function Home() {
  const [snapshot, setCatalog] = useState<Catalog | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const refreshRef = useRef<(() => void) | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    const updater = createCatalogRefresh({
      read,
      onCatalog: (next: Catalog) => { setCatalog(next); setNow(Date.now()); },
      onError: (message: string) => setError(message),
    });
    refreshRef.current = () => { void updater.refresh(); };
    void updater.start();
    return () => { refreshRef.current = null; updater.dispose(); };
  }, []);
  const refresh = () => refreshRef.current?.();
  const catalog = useMemo(() => { const projected = projectCatalogSales(snapshot, now); return projected ? orderCatalog(projected) as Catalog : null; }, [snapshot, now]);

  const packs = catalog ? (tab === "archive" ? catalog.archive : catalog.live) : [];
  const normalized = normalize(query.trim());
  const matchingPacks = useMemo(() => packs.filter(pack => normalize([pack.officialTitle, pack.name, pack.saleId, ...pack.players.map(player => player.name)].join(" ")).includes(normalized)), [packs, normalized]);
  const matchingPlayers = useMemo(() => catalog?.players.filter(player => normalize(`${player.name} ${player.id} ${player.position ?? ""}`).includes(normalized)) ?? [], [catalog, normalized]);
  const currentPack = packs.find(pack => pack.saleId === selected);
  const total = tab === "players" ? matchingPlayers.length : matchingPacks.length;

  return <>
    <a className="skip-link" href="#catalog">목록으로 바로 가기</a>
    <header className="site-header"><a className="brand" href="/" aria-label="efsimulator 홈">ef<span>.</span><strong>efsimulator<small>PLAYER COLLECTIONS</small></strong></a><span className="header-note"><i />검증된 카드와 명단</span></header>
    <main>
      <section className="hero"><div className="hero-copy"><p className="eyebrow">EFOOTBALL / CATALOG</p><h1>한 장의 카드에서,<br /><span>하나의 명단까지.</span></h1><p className="hero-description">판매 중인 선수팩과 지난 명단을 살펴보세요.<br />구성을 확인한 카드만 기록합니다.</p></div><div className="hero-symbol" aria-hidden="true"><span className="orbit" /><span className="center-circle" /><span className="hero-number">11</span><span className="hero-symbol-caption">THE PLAYERS.<br />THE COLLECTION.</span></div></section>

      <section className="overview" aria-label="현재 자료 현황">
        <div><span>판매 중인 팩</span><strong>{catalog?.live.length ?? "—"}<small>팩</small></strong></div><div><span>판매 종료 기록</span><strong>{catalog?.archive.length ?? "—"}<small>팩</small></strong></div><div><span>연결된 선수 카드</span><strong>{catalog?.players.length ?? "—"}<small>장</small></strong></div><div className="updated"><span>마지막 데이터 발행</span><p>{catalog ? dateTime(catalog.manifest.created_at) : "불러오는 중"}<small>한국시간 기준</small></p></div>
      </section>

      <section className="catalog" id="catalog" aria-busy={!catalog && !error}>
        <div className="section-heading"><div><p className="eyebrow">EXPLORE THE COLLECTION</p><h2>기록을 살펴보세요.</h2></div><button className="refresh" onClick={refresh} disabled={!catalog && !error}>새로고침 <span aria-hidden="true">↻</span></button></div>
        <div className="catalog-toolbar"><div className="tabs" role="tablist" aria-label="목록 종류">{(Object.keys(tabLabels) as Tab[]).map(value => <button type="button" role="tab" id={`tab-${value}`} aria-selected={tab === value} aria-controls="catalog-results" key={value} onClick={() => { setTab(value); setSelected(null); }}>{tabLabels[value]}<span>{catalog?.[value].length ?? "—"}</span></button>)}</div><label className="search"><span className="visually-hidden">팩 또는 선수 검색</span><span aria-hidden="true">⌕</span><input type="search" value={query} maxLength={200} placeholder={tab === "players" ? "선수 이름 · 카드 ID 검색" : "팩 이름 · 포함된 선수 검색"} onChange={event => setQuery(event.target.value)} /></label></div>

        {error && catalog && <div className="state-panel" role="status"><h3>새 자료를 확인하지 못했습니다.</h3><p>{error} 마지막으로 확인한 자료를 표시합니다.</p><button className="primary-button" onClick={refresh}>다시 불러오기</button></div>}
        {error && !catalog ? <div className="state-panel" role="alert"><span className="state-icon">!</span><h3>잠시 연결을 확인해 주세요.</h3><p>{error}</p><button className="primary-button" onClick={refresh}>다시 불러오기</button></div> : !catalog ? <div className="state-panel loading" role="status"><div className="loading-bar" /><h3>선수와 명단을 불러오고 있어요.</h3><p>검증된 데이터에 연결하고 있습니다.</p></div> : <div id="catalog-results" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          <div className="results-summary"><p>{query.trim() ? `“${query.trim()}” 검색 결과` : tabLabels[tab]}<strong>{total}건</strong></p><span>{tab === "players" ? "Epic → Show Time → Trend → Highlight · 같은 등급은 OVR 순" : "Epic → Show Time → Trend → Highlight · 같은 등급은 최신순"}</span></div>
          {total === 0 ? <div className="state-panel empty"><span className="eyebrow">NO COLLECTIONS</span><h3>{query.trim() ? "일치하는 자료가 없습니다." : tab === "archive" ? "아직 종료된 명단이 없습니다." : "현재 표시할 자료가 없습니다."}</h3><p>{query.trim() ? "다른 이름이나 카드 ID로 검색해 보세요." : "확인한 자료가 추가되면 이곳에 표시됩니다."}</p></div> : tab === "players" ? <div className="players-grid">{matchingPlayers.map(player => <PlayerTile key={player.id} player={player} />)}</div> : <>
            <div className="packs-grid">{matchingPacks.map((pack, index) => <article className={selected === pack.saleId ? "pack-tile selected" : "pack-tile"} key={pack.saleId}>
              <div className="pack-art"><span className="pack-number">{String(index + 1).padStart(2, "0")}</span><span className="pack-status">{tab === "live" ? "판매 중" : "판매 종료"}</span><div className="pack-lineup" aria-hidden="true">{selectPackPreview(pack).map(player => <Portrait player={player} small key={player.id} />)}</div><span className="pack-art-label">PLAYER COLLECTION</span></div>
              <div className="pack-content"><p className="pack-release">{dateOnly(pack.date)} 출시</p><h3>{pack.officialTitle || pack.name}</h3><div className="pack-counts"><span>전체 <strong>{pack.totalPlayerCount}명</strong></span><span>특수 선수 <strong>{pack.playerCount}명</strong></span></div><p className="pack-end">{tab === "archive" ? "판매 종료" : "판매 종료 예정"}<time dateTime={pack.endsAt}>{dateTime(pack.endsAt)}</time></p><button className="roster-button" aria-expanded={selected === pack.saleId} aria-controls="pack-roster" onClick={() => setSelected(selected === pack.saleId ? null : pack.saleId)}>선수 명단 {selected === pack.saleId ? "닫기" : "보기"}<span aria-hidden="true">{selected === pack.saleId ? "−" : "+"}</span></button></div>
            </article>)}</div>
            {currentPack && <section className="roster" id="pack-roster" aria-label={`${currentPack.officialTitle} 선수 명단`}><div className="roster-heading"><div><p className="eyebrow">THE FULL SPECIAL LINEUP</p><h3>{currentPack.officialTitle || currentPack.name}</h3><p>특수 선수 {currentPack.playerCount}명 · 전체 선수 {currentPack.totalPlayerCount}명{currentPack.standardPlayerCount > 0 ? ` · 일반 선수 ${currentPack.standardPlayerCount}명` : ""}</p></div><button className="close-button" aria-label="선수 명단 닫기" onClick={() => setSelected(null)}>×</button></div><div className="roster-grid">{currentPack.players.map(player => <PlayerTile key={player.id} player={player} small />)}</div>{currentPack.standardPlayerCount > 0 && <p className="roster-note">일반 선수는 인원수로 표시하며 개별 카드를 제공하지 않습니다.</p>}</section>}
          </>}
        </div>}
      </section>
      <aside className="source-note"><span>확인한 정보만, 그대로.</span><p>공식 확률표와 선수팩의 연결을 검증한 자료입니다. 표시된 판매 상태는 조회 시각을 기준으로 합니다.</p><a href="https://efootball-web.konami.net/probability_kr.php" target="_blank" rel="noopener noreferrer">공식 확률표 보기 ↗</a></aside>
    </main>
    <footer><span className="footer-brand">efsimulator<span>.</span></span><p>eFootball 비공식 정보 아카이브<br />게임 정보와 이미지는 각 권리자에게 귀속됩니다.</p><span className="footer-index">CARDS / PACKS / RECORDS</span></footer>
  </>;
}
