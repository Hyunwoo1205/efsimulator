"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { orderCatalog, sortPacks } from "../../lib/catalog-order.mjs";
import { createCatalogRefresh } from "../../lib/catalog-refresh.mjs";

export type Player = { id: string; name: string; slug: string; position: string | null; overallRating: number | null; playingStyle: string | null; playingStyleDefensive: string | null; imageUrl: string | null };
export type Pack = { saleId: string; name: string; officialTitle: string; playerCount: number; totalPlayerCount: number; standardPlayerCount: number; date: string | null; endsAt: string; players: Player[] };
type Manifest = { version_id: string; created_at: string | null };
type Catalog = { manifest: Manifest; live: Pack[]; archive: Pack[]; players: Player[] };
type ApiBody = { data?: unknown; error?: { code?: string }; meta?: { catalog_snapshot_id?: string }; pagination?: { next_cursor?: string | null } };
type CatalogState = { catalog: Catalog | null; live: Pack[]; archive: Pack[]; allPacks: Pack[]; error: string; loading: boolean; now: number; refresh: () => void };
const CatalogContext = createContext<CatalogState | null>(null);

async function read(path: string, signal: AbortSignal): Promise<ApiBody> {
  const response = await fetch(`/api/v1/${path}`, { signal, headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("자료에 연결할 수 없습니다. 다시 로그인한 뒤 시도해 주세요.");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("자료를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  const body = value as ApiBody;
  if (!response.ok) throw new Error(response.status === 404 ? "아직 확인된 자료가 없습니다." : "자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  return body;
}

function validateCatalog(catalog: Catalog) {
  const { live, archive, players } = catalog;
  const playerIds = new Set<string>(); const packIds = new Set<string>();
  for (const player of players) {
    if (typeof player?.id !== "string" || typeof player.name !== "string" || playerIds.has(player.id)) throw new Error("선수 자료를 확인할 수 없습니다. 다시 불러와 주세요.");
    playerIds.add(player.id);
  }
  for (const pack of [...live, ...archive]) {
    if (typeof pack?.saleId !== "string" || packIds.has(pack.saleId) || !Array.isArray(pack.players) || !Number.isFinite(Date.parse(pack.endsAt)) || !Number.isSafeInteger(pack.totalPlayerCount) || !Number.isSafeInteger(pack.playerCount) || pack.standardPlayerCount !== pack.totalPlayerCount - pack.playerCount || pack.standardPlayerCount < 0 || pack.players.length !== pack.playerCount || pack.players.some(player => !playerIds.has(player.id))) throw new Error("선수팩 구성을 확인할 수 없습니다. 새로고침해 주세요.");
    packIds.add(pack.saleId);
  }
}

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const refreshRef = useRef<(() => void) | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    const updater = createCatalogRefresh({
      read,
      transform: (next: Catalog) => { validateCatalog(next); return orderCatalog(next); },
      onCatalog: (next: Catalog) => { setCatalog(next); setNow(Date.now()); },
      onError: (message: string) => setError(message),
      onLoading: (value: boolean) => setLoading(value),
    });
    refreshRef.current = () => { void updater.refresh(); };
    void updater.start();
    return () => { refreshRef.current = null; updater.dispose(); };
  }, []);
  const live = useMemo(() => catalog?.live.filter(pack => Date.parse(pack.endsAt) > now) ?? [], [catalog, now]);
  const archive = useMemo(() => catalog ? sortPacks([...catalog.archive, ...catalog.live.filter(pack => Date.parse(pack.endsAt) <= now)]) : [], [catalog, now]);
  const allPacks = useMemo(() => sortPacks([...live, ...archive]), [live, archive]);
  return <CatalogContext.Provider value={{ catalog, live, archive, allPacks, error, loading, now, refresh: () => refreshRef.current?.() }}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const value = useContext(CatalogContext);
  if (!value) throw new Error("CatalogProvider is required.");
  return value;
}

export const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("ko-KR");
export const packPath = (saleId: string) => `/packs/${encodeURIComponent(saleId)}`;
export const playerPath = (id: string) => `/players/${encodeURIComponent(id)}`;
export const simulatorPath = (saleId: string) => `/simulator?${new URLSearchParams({ pack: saleId })}`;
export const packTitle = (pack: Pack) => pack.officialTitle || pack.name;
export const dateTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(new Date(value)) : "미확인";
export const dateOnly = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미확인";
