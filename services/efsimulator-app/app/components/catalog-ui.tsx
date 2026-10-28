"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { selectPackPreview } from "../../lib/pack-preview.mjs";
import { dateOnly, dateTime, packPath, packTitle, playerPath, useCatalog, type Pack, type Player } from "./catalog-data";

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <>
    <a className="skip-link" href="#main-content">본문으로 바로 가기</a>
    <header className="site-header"><Link className="brand" href="/packs" aria-label="eFsimulator 홈">ef<span>.</span><strong>eFsimulator<small>PLAYERS / PACKS / SIMULATOR</small></strong></Link><nav className="main-nav" aria-label="주요 메뉴">{[{ href: "/packs", title: "선수팩" }, { href: "/players", title: "선수" }, { href: "/simulator", title: "시뮬레이터" }].map(item => <Link href={item.href} key={item.href} aria-current={pathname.startsWith(item.href) ? "page" : undefined}>{item.title}</Link>)}</nav></header>
    <main id="main-content">{children}</main>
    <footer><Link className="footer-brand" href="/packs">eFsimulator<span>.</span></Link><p>eFootball 비공식 팬 프로젝트<br />게임 정보와 이미지는 각 권리자에게 귀속됩니다.</p><span className="footer-index">EXPLORE / COLLECT / SIMULATE</span></footer>
  </>;
}

export function DataBoundary({ children }: { children: React.ReactNode }) {
  const { catalog, error, refresh, loading } = useCatalog();
  if (!catalog && error) return <div className="state-panel" role="alert"><span className="state-icon">!</span><h2>자료를 불러오지 못했어요.</h2><p>{error}</p><button className="primary-button" onClick={refresh}>다시 불러오기</button></div>;
  if (!catalog) return <div className="state-panel loading" role="status"><div className="loading-bar" /><h2>선수와 명단을 불러오고 있어요.</h2><p>잠시만 기다려 주세요.</p></div>;
  return <>{error && <div className="data-warning" role="alert"><p>새 자료를 불러오지 못해 마지막으로 확인한 자료를 표시합니다.</p><button onClick={refresh} disabled={loading}>다시 시도</button></div>}{children}</>;
}

export function RefreshButton() {
  const { loading, refresh } = useCatalog();
  return <button className="refresh" disabled={loading} onClick={refresh}>{loading ? "불러오는 중" : "새로고침"} <span aria-hidden="true">↻</span></button>;
}

export function Portrait({ player, small = false, featured = false }: { player: Player; small?: boolean; featured?: boolean }) {
  const [failed, setFailed] = useState(false);
  let image: string | null = null;
  try { const url = new URL(player.imageUrl ?? ""); if (url.protocol === "https:" && url.hostname === "efimg.com") image = url.href; } catch { /* Optional image. */ }
  return <div className={`portrait${small ? " small" : ""}${featured ? " featured" : ""}`}><span aria-hidden="true" className="portrait-fallback">ef<span>.</span></span>{image && !failed && <img src={image} alt={`${player.name} 선수 카드`} loading={featured ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}</div>;
}

export function PlayerCard({ player }: { player: Player }) {
  return <article className="player-tile"><Link className="player-tile-link" href={playerPath(player.id)}><Portrait player={player} /><div className="player-content"><div className="player-topline"><span className="position">{player.position ?? "포지션 미확인"}</span><span className="rating"><span>OVR</span> {player.overallRating ?? "—"}</span></div><h3>{player.name}</h3><p className="play-style">{player.playingStyle ?? player.playingStyleDefensive ?? "스타일 미확인"}</p><span className="detail-link-label">선수 살펴보기 <span aria-hidden="true">↗</span></span></div></Link></article>;
}

export function PackArtwork({ pack }: { pack: Pack }) {
  return <div className="pack-lineup" aria-hidden="true">{selectPackPreview(pack).map(player => <Portrait player={player} small key={player.id} />)}</div>;
}

export function PackCard({ pack, ended, index = 0 }: { pack: Pack; ended: boolean; index?: number }) {
  return <article className="pack-tile"><Link className="pack-tile-link" href={packPath(pack.saleId)}><div className="pack-art"><span className="pack-number">{String(index + 1).padStart(2, "0")}</span><span className={`pack-status${ended ? " ended" : ""}`}>{ended ? "판매 종료" : "판매 중"}</span><PackArtwork pack={pack} /><span className="pack-art-label">PLAYER COLLECTION</span></div><div className="pack-content"><p className="pack-release">{dateOnly(pack.date)} 출시</p><h3>{packTitle(pack)}</h3><div className="pack-counts"><span>전체 <strong>{pack.totalPlayerCount}명</strong></span><span>특수 선수 <strong>{pack.playerCount}명</strong></span></div><p className="pack-end">{ended ? "판매 종료" : "판매 종료 예정"}<time dateTime={pack.endsAt}>{dateTime(pack.endsAt)}</time></p><span className="roster-button">구성과 선수 살펴보기 <span aria-hidden="true">↗</span></span></div></Link></article>;
}

export function Breadcrumb({ items }: { items: { href?: string; title: string }[] }) {
  return <nav className="breadcrumb" aria-label="현재 위치">{items.map((item, index) => <span key={`${item.title}-${index}`}>{index > 0 && <span aria-hidden="true" className="breadcrumb-divider">/</span>}{item.href ? <Link href={item.href}>{item.title}</Link> : <span aria-current="page">{item.title}</span>}</span>)}</nav>;
}

export function EmptyState({ title, description, href, linkTitle }: { title: string; description: string; href?: string; linkTitle?: string }) {
  return <div className="state-panel empty"><p className="eyebrow">NOTHING HERE YET</p><h2>{title}</h2><p>{description}</p>{href && <Link className="text-button" href={href}>{linkTitle ?? "목록으로 돌아가기"} <span aria-hidden="true">↗</span></Link>}</div>;
}
