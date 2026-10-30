"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Portrait } from "./catalog-ui";
import { StandardCard } from "./standard-card";
import type { Player } from "./catalog-data";
import { orderSimulatorResults } from "../../lib/simulator/result-order.mjs";

const OPENING_DURATION_MS = 1800;

export type DrawBatch = {
  id: string; commandId: string; roundId: string; roundNumber: number;
  count: number; coinCost: number; createdAt: string; acknowledged: boolean;
  results: ({ kind: "special"; cardId: string } | { kind: "standard" })[];
};

/** Only replays a committed batch. Skipping and replaying never call the engine. */
export function SimulatorResults({ batch, players, packTitle, animate, busy, onContinue }: {
  batch: DrawBatch; players: Player[]; packTitle: string; animate: boolean; busy: boolean; onContinue: () => void;
}) {
  const [phase, setPhase] = useState<"opening" | "results">(animate ? "opening" : "results");
  const dialog = useRef<HTMLDialogElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    if (element && !element.open) element.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (phase !== "opening") { next.current?.focus(); return; }
    skip.current?.focus();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) { setPhase("results"); return; }
    // An original 2D transition; no claim about unobserved game/3D timing.
    const timer = window.setTimeout(() => setPhase("results"), OPENING_DURATION_MS);
    const reduce = () => { if (reduced.matches) setPhase("results"); };
    reduced.addEventListener("change", reduce);
    return () => { window.clearTimeout(timer); reduced.removeEventListener("change", reduce); };
  }, [phase]);
  const orderedResults = orderSimulatorResults(batch.results, players);
  return <dialog ref={dialog} className="sim-result-dialog" aria-labelledby="sim-result-heading" onCancel={event => {
    event.preventDefault(); if (phase === "opening") setPhase("results"); else if (!busy) onContinue();
  }}>
    <div className="sim-result-header"><div><p className="eyebrow">{batch.roundNumber}회차 · {batch.count}회 뽑기</p><h2 id="sim-result-heading">{phase === "opening" ? "카드를 공개합니다." : "획득한 선수"}</h2><p>{packTitle}</p></div><span className="sim-result-cost">{batch.coinCost.toLocaleString("ko-KR")} 코인</span></div>
    {phase === "opening" ? <div className="sim-opening"><div className="sim-opening-visual" aria-hidden="true" style={{ "--sim-opening-duration": `${OPENING_DURATION_MS}ms` } as CSSProperties}><div className="sim-sealed-card"><span>ef.</span><small>PLAYER COLLECTION</small></div></div><p role="status">저장된 추첨 결과를 공개하고 있습니다.</p><button ref={skip} className="text-button" type="button" onClick={() => setPhase("results")}>건너뛰기 ↗</button></div> : <>
      <div className={`sim-results-grid ${batch.count === 1 ? "single" : "multiple"}`} aria-label={`획득한 선수 ${batch.count}명`}>
        {orderedResults.map(({ result, player, acquisitionIndex }) => {
          return <div className="sim-result-card" key={`${batch.id}-${acquisitionIndex}`}>
            {player ? <Portrait player={player} featured /> : result.kind === "standard" ? <StandardCard /> : <div className="standard-card-fallback">특수 선수</div>}
          </div>;
        })}
      </div>
      <div className="sim-result-actions"><button type="button" className="text-button" disabled={busy} onClick={() => setPhase("opening")}>연출 다시 보기</button><button ref={next} type="button" className="primary-button" disabled={busy} onClick={onContinue}>{busy ? "확인 중" : "계속하기"} →</button></div>
    </>}
  </dialog>;
}
