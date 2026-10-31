"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { normalize, packTitle, simulatorPath, type Pack } from "./catalog-data";
import { PackArtwork } from "./catalog-ui";
import { selectPackPreview } from "../../lib/pack-preview.mjs";
import "./pack-picker.css";

type Group = "live" | "archive";

export function PackPicker({ live, archive, chosenId, disabled }: { live: Pack[]; archive: Pack[]; chosenId: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<Group>("live");
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement | null>(null);
  const headingId = useId();
  const groups = [{ key: "live" as const, title: "판매 중인 팩", packs: live }, { key: "archive" as const, title: "판매 종료 팩", packs: archive }];
  const packs = group === "live" ? live : archive;
  const matched = useMemo(() => packs.filter(pack => normalize([packTitle(pack), pack.name, ...pack.players.map(player => player.name)].join(" ")).includes(normalize(query.trim()))), [packs, query]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    if (open && !disabled) {
      document.body.style.overflow = "hidden";
      if (!element.open) element.showModal();
    } else if (element.open) element.close();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open, disabled]);

  function close() {
    dialog.current?.close();
    setOpen(false);
  }

  function launch(key: Group, button: HTMLButtonElement) {
    if (disabled) return;
    launcher.current = button;
    setGroup(key); setQuery(""); setOpen(true);
  }

  return <>
    <div className="visual-pack-launchers">{groups.map(item => <button className="visual-pack-launcher" key={item.key} type="button" disabled={disabled || !item.packs.length} aria-haspopup="dialog" onClick={event => launch(item.key, event.currentTarget)}><span>{item.title}<small>{item.packs.length}팩</small></span><strong>이미지로 선택 <span aria-hidden="true">↗</span></strong></button>)}</div>
    <dialog ref={dialog} className="pack-picker-dialog" aria-labelledby={headingId} onCancel={() => setOpen(false)} onClose={() => { setOpen(false); launcher.current?.focus({ preventScroll: true }); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="pack-picker-panel">
        <header className="pack-picker-heading"><h2 id={headingId}>선수팩 선택</h2><button autoFocus type="button" className="pack-picker-close" aria-label="선수팩 선택 닫기" onClick={close}>닫기 <span aria-hidden="true">×</span></button></header>
        <div className="pack-picker-controls"><div className="pack-picker-groups" role="group" aria-label="선수팩 판매 상태">{groups.map(item => <button key={item.key} type="button" aria-pressed={group === item.key} onClick={() => { setGroup(item.key); setQuery(""); }}><span>{item.title}{item.key === "archive" && <span className="visually-hidden"> 체험</span>}</span><small>{item.packs.length}</small></button>)}</div><label className="pack-picker-search"><span className="visually-hidden">팩 이름 또는 포함된 선수 검색</span><input type="search" maxLength={200} placeholder="팩 이름 · 선수 검색" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        <div className="pack-picker-scroll"><div className="pack-picker-grid">{matched.map(pack => {
          const selected = pack.saleId === chosenId;
          const previewNames = selectPackPreview(pack).map(player => player.name).join(" · ");
          return <button key={pack.saleId} type="button" className={`pack-choice${selected ? " is-selected" : ""}`} aria-label={`${packTitle(pack)}${previewNames ? `, 대표 선수 ${previewNames}` : ""}${selected ? ", 현재 선택한 팩" : ", 선택"}`} aria-pressed={selected} disabled={disabled} onClick={() => { if (disabled) return; if (selected) close(); else window.location.assign(simulatorPath(pack.saleId)); }}><span className="pack-choice-art"><PackArtwork pack={pack} /><span className={`pack-choice-state${group === "archive" ? " ended" : ""}`}>{group === "live" ? "판매 중" : "종료 팩 체험"}</span>{selected && <span className="pack-choice-selected">선택됨</span>}</span><span className="pack-choice-copy"><strong>{packTitle(pack)}</strong><span>전체 {pack.totalPlayerCount}명 · 특수 {pack.playerCount}명 <span aria-hidden="true">↗</span></span></span></button>;
        })}</div>{!matched.length && <p className="pack-picker-empty" role="status">{query.trim() ? "일치하는 선수팩이 없습니다." : "선택할 수 있는 선수팩이 없습니다."}</p>}</div>
      </div>
    </dialog>
  </>;
}
