"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { dateTime, packPath, packTitle, useCatalog, type Pack, type Player, type DrawOptions } from "./catalog-data";
import { PackArtwork, PlayerCard } from "./catalog-ui";
import { PackPicker } from "./pack-picker";
import { StandardCard } from "./standard-card";
import { SimulatorResults, type DrawBatch } from "./simulator-results";
import { prepareSimulatorPack } from "../../lib/simulator/prepare.mjs";
import { poolFingerprint } from "../../lib/simulator/session.mjs";
import { secureRandomInt } from "../../lib/simulator/random.mjs";
import { createSimulatorStore } from "../../lib/simulator/storage.mjs";

type Round = { id: string; number: number; remainingSpecialIds: string[]; remainingStandardCount: number; drawCount: number; coinCost: number };
type Session = {
  sessionId: string; saleId: string; revision: number; poolFingerprint: string; pendingBatchId: string | null;
  snapshot: { packTitle: string; players: Player[]; drawOptions: DrawOptions };
  initial: { totalPlayerCount: number; specialPlayerCount: number; standardPlayerCount: number };
  activeRound: Round; rounds: (Round & { reason: string })[]; batches: DrawBatch[];
  resets: { reason: string }[]; totals: { drawCount: number; coinCost: number }; commands: { id: string }[];
};
type Store = ReturnType<typeof createSimulatorStore>;

const messages: Record<string, string> = {
  REVISION_CONFLICT: "다른 탭에서 진행 상황이 바뀌어 최신 기록을 불러왔습니다. 확인 후 다시 눌러 주세요.",
  PENDING_BATCH: "먼저 저장된 추첨 결과를 확인해 주세요.",
  POOL_CHANGED: "이 팩의 구성이 변경되어 추가 추첨을 멈췄습니다. 이전 기록은 보존됩니다.",
  INVALID_SESSION: "저장된 기록을 확인할 수 없어 추첨을 잠갔습니다. 기존 기록은 보존됩니다.",
  STORAGE_QUOTA: "저장 공간이 부족해 추첨하지 않았습니다. 기존 기록은 보존됩니다.",
  STORAGE_UNAVAILABLE: "이 브라우저에서 진행 상황을 저장할 수 없어 추첨을 잠갔습니다.",
  STORAGE_VERSION_UNSUPPORTED: "저장된 기록의 형식을 지원하지 않습니다. 기존 기록은 보존됩니다.",
  INSUFFICIENT_REMAINING: "잔여 인원이 10명 미만입니다. 1회 뽑기로 이번 회차를 마쳐 주세요.",
  RANDOM_UNAVAILABLE: "이 브라우저에서 추첨용 난수를 사용할 수 없습니다.",
  random_unavailable: "이 브라우저에서 추첨용 난수를 사용할 수 없습니다.",
  random_source_failed: "추첨용 난수를 확인하지 못했습니다. 진행 기록은 유지됩니다.",
  random_rejection_limit: "추첨용 난수를 확인하지 못했습니다. 다시 시도해 주세요.",
};
const messageOf = (reason: unknown) => {
  const value = reason as { code?: string; message?: string };
  return messages[value?.code ?? ""] ?? (value?.message && /[가-힣]/.test(value.message) ? value.message : "진행 상황을 확인하지 못했습니다. 다시 시도해 주세요.");
};

export function SimulatorPage() {
  const chosenId = useSearchParams().get("pack") ?? "";
  return <SimulatorSelection key={chosenId} chosenId={chosenId} />;
}

function SimulatorSelection({ chosenId }: { chosenId: string }) {
  const { catalog, live, archive, allPacks, loading, error, refresh } = useCatalog();
  const pack = allPacks.find(item => item.saleId === chosenId);
  const active = live.some(item => item.saleId === chosenId);
  const preparation = useMemo(() => prepareSimulatorPack({ saleId: chosenId, catalog, loading, error }), [chosenId, catalog, loading, error]);
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [animateId, setAnimateId] = useState<string | null>(null);
  const store = useRef<Store | null>(null);
  const lock = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const current = useRef({ preparation, pack });
  current.current = { preparation, pack };

  const reload = useCallback(async () => {
    const storage = store.current;
    if (!chosenId || !storage) return;
    const saved = await storage.load(chosenId) as Session | null;
    if (store.current !== storage) return;
    setSession(saved); return saved;
  }, [chosenId]);
  useEffect(() => {
    let mounted = true;
    const storage = createSimulatorStore({ randomInt: secureRandomInt });
    store.current = storage;
    if (typeof BroadcastChannel !== "undefined") channel.current = new BroadcastChannel("efsimulator-progress-v1");
    const update = () => { if (!lock.current) void reload().catch(reason => { if (mounted) setStorageError(messageOf(reason)); }); };
    if (channel.current) channel.current.onmessage = event => { if (event.data?.saleId === chosenId) update(); };
    window.addEventListener("focus", update);
    void (async () => {
      try { if (chosenId) { const saved = await storage.load(chosenId) as Session | null; if (mounted) setSession(saved); } }
      catch (reason) { if (mounted) setStorageError(messageOf(reason)); }
      finally { if (mounted) setRestoring(false); }
    })();
    return () => { mounted = false; store.current = null; channel.current?.close(); channel.current = null; window.removeEventListener("focus", update); void storage.close(); };
  }, [chosenId, reload]);
  useEffect(() => {
    if (restoring || !pack || !preparation.ready || !store.current) return;
    let mounted = true;
    const storage = store.current;
    void storage.ensure({ preparation, pack }).then(value => { if (mounted && store.current === storage) { setSession(value as Session); setStorageError(""); } }).catch(reason => { if (mounted && store.current === storage) setStorageError(messageOf(reason)); });
    return () => { mounted = false; };
  }, [restoring, pack, preparation]);

  async function execute(type: "draw" | "reset" | "acknowledge", count?: number, batchId?: string) {
    if (lock.current || !session || !store.current) return;
    const storage = store.current;
    lock.current = true; setBusy(true); setStorageError("");
    let commandId: string | null = null;
    const committed = (next: Session) => {
      if (store.current !== storage) return;
      setSession(next); setResetOpen(false);
      if (type === "draw") setAnimateId(next.pendingBatchId);
      if (type === "acknowledge") { setReplayId(null); setAnimateId(null); }
      channel.current?.postMessage({ saleId: chosenId });
    };
    try {
      commandId = crypto.randomUUID();
      const command = { id: commandId, type, expectedRevision: session.revision, ...(count ? { count } : {}), ...(batchId ? { batchId } : {}) };
      const context = current.current;
      const next = await storage.execute({ saleId: chosenId, command, pack: context.pack, preparation: context.preparation, getContext: () => current.current }) as Session;
      committed(next);
    } catch (reason) {
      if (store.current !== storage) return;
      // A lost completion response is resolved by the saved command, never rerolled.
      try {
        const saved = await reload();
        if (store.current !== storage) return;
        if (saved && commandId && saved.commands.some(item => item.id === commandId)) committed(saved);
        else setStorageError(messageOf(reason));
      } catch { if (store.current === storage) setStorageError(messageOf(reason)); }
    } finally { if (store.current === storage) { lock.current = false; setBusy(false); } }
  }

  const round = session?.activeRound;
  const remaining = round ? round.remainingSpecialIds.length + round.remainingStandardCount : pack?.totalPlayerCount ?? 0;
  const pending = session?.batches.find(batch => batch.id === session.pendingBatchId) ?? null;
  const result = pending ?? session?.batches.find(batch => batch.id === replayId) ?? null;
  let changed = false;
  if (session && pack && preparation.ready) { try { changed = session.poolFingerprint !== poolFingerprint(pack); } catch { changed = true; } }
  const ready = Boolean(preparation.ready && session && !restoring && !storageError && !changed && !busy && !pending && !replayId && !resetOpen);
  const options = session?.snapshot.drawOptions ?? pack?.drawOptions;
  const title = pack ? packTitle(pack) : session?.snapshot.packTitle ?? "선수팩";
  const initial = session?.initial ?? (pack ? { totalPlayerCount: pack.totalPlayerCount, specialPlayerCount: pack.playerCount, standardPlayerCount: pack.standardPlayerCount } : null);
  const availableIds = new Set(round?.remainingSpecialIds ?? pack?.players.map(player => player.id) ?? []);
  const displayPlayers = session?.snapshot.players ?? pack?.players ?? [];

  return <>
    <section className="page-intro simulator-intro"><h1 className="display-title">PACK OPENING SIMULATOR</h1></section>
    <section className="simulator-layout sim-play-layout">
      <aside className="simulator-picker">
        <PackPicker live={live} archive={archive} chosenId={chosenId} disabled={busy || Boolean(pending)} />
        <a className="back-to-packs" href="/packs">모든 선수팩 살펴보기 ↗</a>
      </aside>
      <div className="simulator-preview">
        {!chosenId ? <div className="simulator-welcome"><span className="simulator-welcome-mark" aria-hidden="true">ef.</span><h2>어떤 선수팩을 열어볼까요?</h2><p>판매 중 또는 판매 종료 팩을 선택하세요.</p>{!catalog && <button className="text-button" onClick={refresh}>{loading ? "자료 확인 중" : "다시 불러오기"}</button>}</div> : !pack && !session ? <div className="state-panel" role="status"><h2>{loading || restoring ? "선수팩을 확인하고 있어요." : "선수팩을 불러오지 못했어요."}</h2><p>{storageError || error || "목록에서 다른 팩을 선택하거나 다시 불러와 주세요."}</p><button className="primary-button" disabled={loading} onClick={refresh}>다시 불러오기</button></div> : <div className="simulator-selected">
          <div className="simulator-selected-top"><div><p className="eyebrow">{active ? "LIVE COLLECTION" : "ARCHIVE / SAVED EXPERIENCE"}</p><h2>{title}</h2>{pack && <p className="simulator-deadline">{active ? "판매 종료 예정" : "판매 종료 팩 체험"} · {dateTime(pack.endsAt)}</p>}</div>{pack && <div className="simulator-selected-art"><PackArtwork pack={pack} /></div>}</div>
          {initial && <div className="sim-progress" aria-live="polite"><div><span>남은 선수</span><strong>{remaining}<small> / {initial.totalPlayerCount}</small></strong></div><div><span>남은 특수</span><strong>{round?.remainingSpecialIds.length ?? initial.specialPlayerCount}<small>명</small></strong></div><div><span>남은 일반</span><strong>{round?.remainingStandardCount ?? initial.standardPlayerCount}<small>명</small></strong></div></div>}
          {round && <p className="sim-round-label">{round.number}회차 · 이번 회차 {round.drawCount}회 / {round.coinCost.toLocaleString("ko-KR")} 코인 <span>전체 누적 {session!.totals.drawCount}회 / {session!.totals.coinCost.toLocaleString("ko-KR")} 코인</span></p>}
          {session?.rounds.at(-1)?.reason === "exhausted" && round?.drawCount === 0 && <p className="sim-exhausted" role="status">이전 회차의 선수를 모두 획득했습니다. 마지막 결과와 기록을 보존하고 새 회차를 준비했습니다.</p>}
          {(storageError || error || changed) && <div className="data-warning" role="alert"><p>{storageError || (changed ? messages.POOL_CHANGED : error)}</p><button disabled={busy || loading} onClick={() => { setStorageError(""); refresh(); void reload().catch(reason => setStorageError(messageOf(reason))); }}>다시 확인</button></div>}
          <div className="sim-play-actions">
            {[1, 10].filter(count => count === 1 || options?.ten.supported).map(count => <button key={count} className="primary-button" type="button" disabled={!ready || (count === 10 && remaining < 10)} onClick={event => { actionRef.current = event.currentTarget; void execute("draw", count); }}>{busy ? "저장 중" : `${count}회 뽑기`} <span>{count === 1 ? options?.single.coinCost : options?.ten.coinCost} 코인</span></button>)}
            <button className="text-button" type="button" disabled={!session || busy || Boolean(pending) || Boolean(replayId) || changed || !preparation.ready} onClick={() => setResetOpen(true)}>팩 리셋</button>
          </div>
          {remaining > 0 && remaining < 10 && options?.ten.supported && <p className="sim-help">잔여 인원이 10명 미만이므로 1회 뽑기로 이번 회차를 마쳐 주세요.</p>}
          {!preparation.ready && !error && <p className="sim-help" role="status">{loading ? "최신 자료를 확인 중입니다." : "추첨에 필요한 팩 구성을 확인해 주세요."}</p>}
          {restoring && <p className="sim-help" role="status">저장된 진행 상황을 확인하고 있습니다.</p>}
          {resetOpen && <div className="sim-reset-confirm" role="group" aria-label="팩 리셋 확인"><p>현재 팩의 전체 풀을 새 회차로 복원할까요? 이전 획득 내역과 누적 코인 사용량은 보존됩니다.</p><button autoFocus className="primary-button" disabled={busy} onClick={() => { void execute("reset"); }}>새 회차 시작</button><button className="text-button" disabled={busy} onClick={() => setResetOpen(false)}>취소</button></div>}
          <section className="sim-pool-section"><div className="sim-pool-heading"><h3>특수 선수 명단</h3><button type="button" className="text-button" aria-expanded={rosterOpen} aria-controls="sim-special-roster" onClick={() => setRosterOpen(value => !value)}>{rosterOpen ? "명단 접기" : "특수 선수 모두 보기"} {rosterOpen ? "−" : "+"}</button></div>
            {rosterOpen && <div id="sim-special-roster" className="simulator-roster-grid">{displayPlayers.map(player => <div className={`sim-roster-card ${availableIds.has(player.id) ? "" : "is-acquired"}`} key={player.id}><PlayerCard player={player} />{!availableIds.has(player.id) && <span className="sim-acquired-tag">획득</span>}</div>)}</div>}
            {initial && initial.standardPlayerCount > 0 && <div className="simulator-standard-preview"><StandardCard /><div><h3>일반 선수 {round?.remainingStandardCount ?? initial.standardPlayerCount}명 남음</h3></div></div>}
          </section>
          {session && session.batches.length > 0 && <details className="sim-history"><summary>획득 내역 · 총 {session.totals.drawCount}명</summary><ol>{session.batches.toReversed().map(batch => <li key={batch.id}><div><strong>{batch.roundNumber}회차 · {batch.count}명</strong><small>{dateTime(batch.createdAt)} · {batch.coinCost} 코인</small><p>{batch.results.map(result => result.kind === "special" ? session.snapshot.players.find(player => player.id === result.cardId)?.name ?? "특수 선수" : "일반 선수").join(" · ")}</p></div><button type="button" className="text-button" disabled={busy || Boolean(pending)} onClick={() => { setAnimateId(null); setReplayId(batch.id); }}>다시 보기</button></li>)}</ol></details>}
          {pack && <a className="text-button sim-pack-detail" href={packPath(pack.saleId)}>팩 상세 보기 ↗</a>}
          <p className="sim-storage-note">이 기기·브라우저에 저장됩니다. 브라우저 데이터 삭제나 기기 변경 시 기록을 복구할 수 없습니다.</p>
        </div>}
      </div>
    </section>
    {result && session && <SimulatorResults key={result.id} batch={result} players={session.snapshot.players} packTitle={session.snapshot.packTitle} animate={animateId === result.id} busy={busy} onContinue={() => {
      if (pending) void execute("acknowledge", undefined, pending.id); else { setReplayId(null); setAnimateId(null); }
      window.setTimeout(() => actionRef.current?.focus(), 0);
    }} />}
  </>;
}
