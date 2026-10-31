"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dateOnly, dateTime, normalize, packPath, packTitle, simulatorPath, useCatalog, type Pack } from "./catalog-data";
import { Breadcrumb, DataBoundary, EmptyState, PackArtwork, PackCard, PlayerCard, Portrait, RefreshButton } from "./catalog-ui";
import { drawCostLabel, readDrawOptions } from "../../lib/draw-options.mjs";

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
    <section className="page-intro"><h1 className="display-title">PLAYER COLLECTIONS</h1></section>
    <section className="overview" aria-label="현재 자료 현황"><div><span>판매 중인 팩</span><strong>{catalog ? live.length : "—"}<small>팩</small></strong></div><div><span>판매 종료 기록</span><strong>{catalog ? archive.length : "—"}<small>팩</small></strong></div><div><span>연결된 선수 카드</span><strong>{catalog?.players.length ?? "—"}<small>장</small></strong></div><div className="updated"><span>마지막 자료 갱신</span><p>{catalog ? dateTime(catalog.manifest.created_at) : "자료 확인 중"}<small>한국시간 기준</small></p></div></section>
    <section className="catalog content-section"><div className="section-heading"><h2>선수팩</h2><RefreshButton /></div><div className="catalog-toolbar"><div className="tabs" aria-label="선수팩 상태"><button type="button" aria-pressed={filter === "live"} onClick={() => setFilter("live")}>판매 중인 팩<span>{catalog ? live.length : "—"}</span></button><button type="button" aria-pressed={filter === "archive"} onClick={() => setFilter("archive")}>판매 종료<span>{catalog ? archive.length : "—"}</span></button></div><SearchField value={query} onChange={setQuery} label="선수팩 또는 포함된 선수 검색" placeholder="팩 이름 · 포함된 선수 검색" /></div><DataBoundary><div className="results-summary" role="status"><p>{query.trim() ? `“${query.trim()}” 검색 결과` : filter === "live" ? "판매 중인 선수팩" : "판매 종료된 선수팩"}<strong>{matched.length}팩</strong></p></div>{matched.length ? <PackCollection packs={matched} ended={filter === "archive"} expanded={expanded} onExpanded={setExpanded} /> : <EmptyState title={query ? "일치하는 선수팩이 없습니다." : filter === "archive" ? "아직 종료된 명단이 없습니다." : "현재 판매 중인 선수팩이 없습니다."} description={query ? "다른 팩 이름이나 선수 이름으로 검색해 보세요." : "확인된 선수팩이 추가되면 이곳에 표시됩니다."} />}</DataBoundary></section>
  </>;
}

export function PlayersPage() {
  const { catalog } = useCatalog(); const [query, setQuery] = useState(""); const [position, setPosition] = useState("");
  const positions = useMemo(() => [...new Set((catalog?.players ?? []).map(player => player.position).filter((value): value is string => Boolean(value)))].sort(), [catalog]);
  const players = useMemo(() => (catalog?.players ?? []).filter(player => (!position || player.position === position) && normalize(`${player.name} ${player.id} ${player.position ?? ""}`).includes(normalize(query.trim()))), [catalog, query, position]);
  return <><section className="page-intro"><h1 className="display-title">PLAYER CARDS</h1></section><section className="content-section"><div className="section-heading"><h2>선수</h2><RefreshButton /></div><div className="player-toolbar"><SearchField value={query} onChange={setQuery} label="선수 이름 또는 카드 번호 검색" placeholder="선수 이름 · 카드 번호 검색" /><label className="position-filter"><span className="visually-hidden">포지션 선택</span><select value={position} onChange={event => setPosition(event.target.value)}><option value="">모든 포지션</option>{positions.map(value => <option value={value} key={value}>{value}</option>)}</select></label></div><DataBoundary><div className="results-summary" role="status"><p>{query.trim() ? `“${query.trim()}” 검색 결과` : "선수 카드"}<strong>{players.length}장</strong></p></div>{players.length ? <div className="players-grid">{players.map(player => <PlayerCard player={player} key={player.id} />)}</div> : <EmptyState title="일치하는 선수가 없습니다." description="다른 선수 이름으로 검색하거나 포지션을 바꿔 보세요." />}</DataBoundary></section></>;
}

export function PackDetailPage({ saleId }: { saleId: string }) {
  const { allPacks, live } = useCatalog(); const pack = allPacks.find(item => item.saleId === saleId); const active = live.some(item => item.saleId === saleId);
  return <><Breadcrumb items={[{ href: "/packs", title: "선수팩" }, { title: pack ? packTitle(pack) : "선수팩 상세" }]} /><DataBoundary>{!pack ? <EmptyState title="선수팩을 찾을 수 없습니다." description="주소를 확인하거나 선수팩 목록에서 다시 선택해 주세요." href="/packs" /> : <>
    <section className="pack-detail-hero"><div className="detail-pack-art"><span className={`pack-status${active ? "" : " ended"}`}>{active ? "판매 중" : "판매 종료"}</span><PackArtwork pack={pack} /><span className="detail-art-label">THE FULL COLLECTION</span></div><div className="detail-pack-copy"><p className="eyebrow">PLAYER COLLECTION</p><h1>{packTitle(pack)}</h1>{pack.name !== packTitle(pack) && <p className="detail-secondary-name">{pack.name}</p>}<dl className="pack-dates"><div><dt>출시일</dt><dd>{dateOnly(pack.date)}</dd></div><div><dt>{active ? "판매 종료 예정" : "판매 종료"}</dt><dd>{dateTime(pack.endsAt)}</dd></div></dl><PackDrawOptions pack={pack} /><a className="primary-button action-link" href={simulatorPath(pack.saleId)}>{active ? "시뮬레이터에서 이 팩 보기" : "판매 종료 팩 체험에서 보기"} <span aria-hidden="true">↗</span></a></div></section>
    <PackCounts pack={pack} /><section className="content-section"><div className="section-heading"><h2>특수 선수</h2><span className="section-total">특수 선수 {pack.playerCount}명</span></div><div className="players-grid">{pack.players.map(player => <PlayerCard key={player.id} player={player} />)}</div>{pack.standardPlayerCount > 0 && <div className="standard-note"><span>일반 선수 {pack.standardPlayerCount}명</span></div>}</section>
  </>}</DataBoundary></>;
}

export function PlayerDetailPage({ id }: { id: string }) {
  const { catalog, allPacks, live } = useCatalog(); const player = catalog?.players.find(item => item.id === id); const packs = allPacks.filter(pack => pack.players.some(member => member.id === id)); const liveIds = new Set(live.map(pack => pack.saleId));
  return <><Breadcrumb items={[{ href: "/players", title: "선수" }, { title: player?.name ?? "선수 상세" }]} /><DataBoundary>{!player ? <EmptyState title="선수 카드를 찾을 수 없습니다." description="주소를 확인하거나 선수 목록에서 다시 선택해 주세요." href="/players" /> : <>
    <section className="player-detail-hero"><div className="player-detail-art"><Portrait player={player} featured /></div><div className="player-detail-copy"><p className="eyebrow">PLAYER PROFILE</p><div className="player-detail-position">{player.position ?? "포지션 미확인"}</div><h1>{player.name}</h1><div className="detail-rating"><span>표시 OVR</span><strong>{player.overallRating ?? "—"}</strong></div><dl className="player-facts"><div><dt>플레이 스타일</dt><dd>{player.playingStyle ?? "미확인"}</dd></div><div><dt>수비 플레이 스타일</dt><dd>{player.playingStyleDefensive ?? "미확인"}</dd></div><div><dt>카드 번호</dt><dd className="player-card-id">{player.id}</dd></div></dl></div></section><section className="content-section"><div className="section-heading"><h2>포함된 선수팩</h2><span className="section-total">{packs.length}팩</span></div>{packs.length ? <div className="packs-grid">{packs.map((pack, index) => <PackCard pack={pack} key={pack.saleId} ended={!liveIds.has(pack.saleId)} index={index} />)}</div> : <EmptyState title="연결된 선수팩을 확인 중입니다." description="선수팩 목록에서 다른 명단도 살펴보세요." href="/packs" />}</section>
  </>}</DataBoundary></>;
}

export { SimulatorPage } from "./simulator-page";
