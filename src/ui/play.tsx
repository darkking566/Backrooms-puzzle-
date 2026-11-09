import { SupplyCratePanel } from "./supply-crate";
import { reachableCrate } from "../core/level1";
/* The exploration screen: the 3D stage, status, narration, quick actions, and every in-game panel. */
import { useEffect, useRef, useState } from "preact/hooks";
import type { Command, Game } from "../core/game";
import { CARRY } from "../core/game";
import { DV, type Dir, type Text } from "../core/types";
import { View, type Pick } from "../render/view";
import { feelings, hasStatus, H } from "../systems/survival";
import { edgeCells, passable } from "../world/types";
import { ctx, L, U, lang, save } from "./ctx";
import type { InvItem } from "../state/types";
import { NotebookMap } from "./notebook-map";
import { elapsedMessages, skipMs } from "./time";
import { LockedPackPanel } from "./locked-pack";
import { RoomPersonPanel } from "./room-person";

type Sheet = null | { kind: "bag" } | { kind: "notes" } | { kind: "body" } | { kind: "search" } | { kind: "rest" } | { kind: "pit" } | { kind: "ceiling" }
  | { kind: "elder" } | { kind: "crate"; id: string } | { kind: "manila" } | { kind: "cabinet" } | { kind: "boil"; salt: string } | { kind: "wring" } | { kind: "log" } | { kind: "map" } | { kind: "lockedPack" } | { kind: "roomPerson" };
const DEV = typeof location !== "undefined" && (/[?&]dev\b/.test(location.search) || location.hash === "#dev");
const ICON: Record<string, string> = { water: "💧", food: "🍞", awake: "☾", sanity: "◉", health: "✚", wretched: "✶", status: "!" };

export function Play({ onEnd }: { onEnd: () => void }) {
  const stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0); const rerender = () => setTick(x => x + 1);
  const [sheet, setSheet] = useState<Sheet>(null);
  const sheetRef = useRef(sheet); sheetRef.current = sheet;
  const [caption, setCaption] = useState<Text | null>(null);
  const [hints, setHints] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState<{ id: number; text: Text; ms: number } | null>(null);   // the screen dims while time passes
  const [delta, setDelta] = useState<{ id: number; text: string } | null>(null);              // "+20 min" next to the clock
  const holdUntil = useRef(0);
  const capTimer = useRef(0);
  const g = ctx.game!;

  const showCaption = (t: Text) => { setCaption(t); clearTimeout(capTimer.current); capTimer.current = window.setTimeout(() => setCaption(null), 6500); };

  useEffect(() => {
    ctx.view = new View(canvas.current!, labels.current!);
    const v = ctx.view, s = ctx.meta.settings;
    v.flash = s.flash; v.reduceMotion = s.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches; v.setQuality(s.quality);
    v.labelText = labelText; v.onPick = onPick; v.onLookStart = () => {};
    ctx.audio.onCaption = showCaption;
    if (s.sound && !ctx.audio.on) addEventListener("pointerdown", () => { ctx.audio.enable(true); ctx.audio.ambience(g); }, { once: true });   // browsers need a gesture before sound
    v.attach(g); ctx.audio.ambience(g); v.kick(); rerender();
    const key = (e: KeyboardEvent) => {
      if (sheetRef.current || (e.target as HTMLElement).closest?.("input, textarea, select")) return;
      if (e.key === "ArrowLeft") act({ type: "turn", dir: -1 }); else if (e.key === "ArrowRight") act({ type: "turn", dir: 1 }); else if (e.key === "ArrowDown") act({ type: "turn", dir: 2 });
    };
    addEventListener("keydown", key);
    const crackle = setInterval(() => ctx.audio.crackle((1 - v.tubeValue) * .22), 120);
    return () => { removeEventListener("keydown", key); clearInterval(crackle); v.dispose(); ctx.view = null; };
  }, []);
  useEffect(() => { if (ctx.view) { ctx.view.labelText = labelText; ctx.view.onPick = onPick; } });

  /* ---------- running commands ---------- */
  function act(cmd: Command, then?: () => void) {
    const v = ctx.view!; if (v.busy || g.run.ended || performance.now() < holdUntil.current || (g.run.pendingEvent && cmd.type !== "choose")) return;
    const out = g.dispatch(cmd);
    if (out.interrupted) setSheet(null);
    showTime(cmd, out.minutes, !!out.ended, out.perceivedTime);
    for (const s of out.sfx) ctx.audio.sfx(s);
    save();
    const finish = () => {
      setBusy(false); v.syncEnv(); ctx.audio.ambience(g);
      if (out.caption) { if (out.captionVisual) showCaption(out.caption); else ctx.audio.caption(out.caption, g); }
      v.kick(); rerender();
      if (out.ended) { ctx.audio.sfx("end"); setTimeout(onEnd, g.run.ended?.ending === "closed_loop" ? 900 : 500); }
      else if (then && !out.interrupted) then();
    };
    if (out.levelChanged) { setSheet(null); v.attach(g); finish(); }
    else if (out.anim.kind === "move" || out.anim.kind === "turn") {
      v.syncEnv(); v.rebuild(out.anim.kind === "turn" ? 3 : 1);       // build the destination (already shifted) before walking there
      const { i, j } = g.run.pos, z = g.world.zone(i, j);
      ctx.audio.step(g.world.level === "level-1" ? g.world.wet(i, j) ? "water" : "concrete" : z === "dark" ? "water" : z === "manila" ? "wood" : g.world.redDist(i, j) <= 2.3 ? "sticky" : "carpet", out.anim.kind === "move" ? 3 : 1);
      setBusy(true); v.play(out.anim, finish);
    } else if (out.anim.kind === "door") { setBusy(true); v.play(out.anim, () => { v.rebuild(1); finish(); }); }
    else { if (out.rebuild) v.rebuild(cmd.type === "rest" ? 2 : 1); finish(); }
    rerender();
  }
  function showTime(cmd: Command, m: number, ended: boolean, perceived?: Text) {
    if (m <= 0) return;
    const messages = elapsedMessages(m, g.has("watch"), perceived), id = performance.now();
    setDelta({ id, text: L(messages.delta) });
    if (ended || cmd.type === "move" || cmd.type === "turn" || m < 15) return;   // walking already shows time passing; short things don't need a pause
    const ms = skipMs(m);
    setSkip({ id, ms, text: cmd.type === "rest" ? messages.slept : messages.passed });
    holdUntil.current = id + ms * .6;
    setTimeout(() => setSkip(s => (s && s.id === id ? null : s)), ms);
  }
  const moveThen = (d: Dir, cmd: Command) => act({ type: "move", d }, () => act(cmd));
  function adjacentDir(i: number, j: number): Dir | null {
    const { i: pi, j: pj, d: pd } = g.run.pos, dx = i - pi, dz = j - pj;
    const d = DV.findIndex(v => v[0] === dx && v[1] === dz);
    if (d < 0 || d === (pd + 2) % 4 || !passable(g.world.edgeAt(pi, pj, d))) return null;
    return d as Dir;
  }
  function onPick(p: Pick) {
    if (sheet || g.run.pendingEvent) return;
    const { i, j } = g.run.pos;
    switch (p.kind) {
      case "crate": {
        if (g.world.level !== "level-1") return;
        const crate = g.world.crates.get(p.id); if (!crate) return;
        if (reachableCrate(g.run, g.world, crate)) return setSheet({ kind: "crate", id: p.id });
        const d = adjacentDir(crate.i, crate.j); return d === null ? say(U("tooFar")) : act({ type: "move", d }, () => setSheet({ kind: "crate", id: p.id }));
      }
      case "guide": return act({ type: "readGuide" });
      case "routeSign": return act({ type: "readSign" });
      case "baseSupplies": return act({ type: "baseSupplies" });
      case "elder": return g.zoneHere() === "alpha" ? openElder() : say(U("tooFar"));
      case "noticeboard": return g.zoneHere() === "alpha" ? act({ type: "readNotice" }) : say(U("tooFar"));
      case "roomPerson": return g.canTalkToPerson() ? openPerson() : say(U("tooFar"));
      case "lockedPack": {
        if (g.canReachPack()) return openPack();
        const pos = g.run.lockedPack?.pos, d = pos ? adjacentDir(pos.i, pos.j) : null;
        return d === null ? say(U("tooFar")) : act({ type: "move", d }, () => { if (g.canReachPack() && !g.run.pendingEvent) openPack(); });
      }
      case "exit": return act({ type: "move", d: p.d });
      case "item": { if (p.i === i && p.j === j) return act({ type: "pickup", key: p.key }); const d = adjacentDir(p.i, p.j); return d === null ? say(U("tooFar")) : moveThen(d, { type: "pickup", key: p.key }); }
      case "corpse": { const [ci, cj] = g.world.corpse!; if (ci === i && cj === j) return act({ type: "corpse" }); const d = adjacentDir(ci, cj); return d === null ? say(U("tooFar")) : moveThen(d, { type: "corpse" }); }
      case "door": return act({ type: "door", edge: p.edge });
      case "flicker": return act({ type: "flicker", edge: p.edge });
      case "wall": return act({ type: "touch", edge: p.edge });
      case "tally": case "peel": return act({ type: "examine", what: p.kind });
      case "hole": return here(c => c.hole) ? setSheet({ kind: "ceiling" }) : say(U("tooFar"));
      case "pit": return here(c => c.pits.length > 0) ? setSheet({ kind: "pit" }) : say(U("tooFar"));
      case "salt": return here(c => c.salt) ? act({ type: "salt" }) : say(U("tooFar"));
      case "notes": return inManila() ? openManila() : say(U("tooFar"));
      case "cabinet": return inManila() ? setSheet({ kind: "cabinet" }) : say(U("tooFar"));
    }
  }
  const here = (f: (c: ReturnType<typeof g.cellHere>) => boolean) => f(g.cellHere());
  const inManila = () => g.zoneHere() === "manila";
  const openManila = () => { act({ type: "examine", what: "notes" }); ctx.audio.sfx("paper"); setSheet({ kind: "manila" }); };
  const openPack = () => { act({ type: "packExamine" }); setSheet({ kind: "lockedPack" }); };
  const openPerson = () => { act({ type: "roomPersonTalk" }); setSheet({ kind: "roomPerson" }); };
  const openElder = () => { act({ type: "elderTalk" }); setSheet({ kind: "elder" }); };
  const say = (s: string) => { g.run.log.push({ t: { zh: s, en: s } }); rerender(); };

  function labelText(p: Pick): string {
    const { d } = g.run.pos;
    switch (p.kind) {
      case "crate": return U("supplyCrate"); case "guide": return U("survivalGuide");
      case "routeSign": return U("routeSign"); case "baseSupplies": return U("baseSupplies");
      case "elder": return L(g.elder.text.name); case "noticeboard": return L(g.elder.text.board);
      case "roomPerson": return L(g.personQuest.text.name);
      case "lockedPack": return L(g.packPuzzle.text.name);
      case "exit": { const t = g.world.edgeAt(g.run.pos.i, g.run.pos.j, p.d); return "→ " + U(p.d === d ? "ahead" : p.d === (d + 3) % 4 ? "toLeft" : "toRight") + (t === "arch" ? U("archS") : t?.endsWith("-open") ? U("doorS") : ""); }
      case "item": { for (const c of g.world.cells.values()) { const it = c.items.find(x => x.key === p.key); if (it) return L(g.itemName(it)); } return ""; }
      case "door": return U(g.world.edges.get(p.edge) === "door-metal" ? "metalDoor" : "woodDoor");
      case "flicker": return U("flickerWall");
      case "corpse": return U("corpseHere"); case "salt": return U("salt"); case "hole": return U("hole"); case "pit": return U("pit");
      case "tally": return U("tally"); case "peel": return U("peel"); case "notes": return U("notesObj"); case "cabinet": return U("cabinet");
      default: return "";
    }
  }

  /* ---------- derived ---------- */
  const r = g.run, c = g.cellHere(), feel = feelings(r), watch = g.has("watch");
  const clock = (r.clock0 + r.time) % 1440, day = Math.floor((r.clock0 + r.time) / 1440) + 1;
  const timeText = watch ? `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")} · ${U("day", { d: day })}` : U("unknownTime");
  const log = r.log.slice(-3);
  const near: { label: string; tag: string; verb: string; run: () => void }[] = [];
  for (const it of c.items) near.push({ tag: U("atFeet"), label: L(g.itemName(it)), verb: U("pickUp"), run: () => act({ type: "pickup", key: it.key }) });
  if (g.canReachPack()) near.push({ tag: inManila() ? U("inRoom") : U("atFeet"), label: L(g.packPuzzle.text.name), verb: U("look"), run: openPack });
  if (g.canTalkToPerson()) near.push({ tag: U("inRoom"), label: L(g.personQuest.text.name), verb: U("talk"), run: openPerson });
  if (g.world.corpse && g.meta.corpses[g.run.level] && g.world.corpse[0] === r.pos.i && g.world.corpse[1] === r.pos.j) near.push({ tag: U("atFeet"), label: U("corpseHere"), verb: U("searchBody"), run: () => act({ type: "corpse" }) });
  if (c.salt) near.push({ tag: U("here"), label: U("salt"), verb: U("scrape"), run: () => act({ type: "salt" }) });
  if (c.hole) near.push({ tag: U("here"), label: U("hole"), verb: U("reach"), run: () => setSheet({ kind: "ceiling" }) });
  if (c.pits.length) near.push({ tag: U("here"), label: U("pit"), verb: U("look"), run: () => setSheet({ kind: "pit" }) });
  if (g.world.level === "level-1") {
    for (const crate of g.world.crates.values()) if (reachableCrate(r, g.world, crate)) near.push({ tag: U("atFeet"), label: U("supplyCrate"), verb: U("open"), run: () => setSheet({ kind: "crate", id: crate.id }) });
    if (g.zoneHere() === "arrival" || g.zoneHere() === "alpha") near.push({ tag: U("inRoom"), label: U("survivalGuide"), verb: U("read"), run: () => act({ type: "readGuide" }) });
    if (g.world.routeMark(r.pos.i, r.pos.j) !== null) near.push({ tag: U("inRoom"), label: U("routeSign"), verb: U("read"), run: () => act({ type: "readSign" }) });
    if (g.zoneHere() === "alpha") near.push({ tag: U("inRoom"), label: U("baseSupplies"), verb: U("collectSupplies"), run: () => act({ type: "baseSupplies" }) });
    if (g.zoneHere() === "alpha") {
      near.push({ tag: U("inRoom"), label: L(g.elder.text.name), verb: U("look"), run: openElder });
      near.push({ tag: U("inRoom"), label: L(g.elder.text.board), verb: U("read"), run: () => act({ type: "readNotice" }) });
    }
  }
  if (inManila()) { near.push({ tag: U("inRoom"), label: U("notesObj"), verb: U("read"), run: openManila }); near.push({ tag: U("inRoom"), label: U("cabinet"), verb: U("open"), run: () => setSheet({ kind: "cabinet" }) }); }
  const ev = r.pendingEvent ? ctx.content.events.find(e => e.id === r.pendingEvent) : null;
  const lock = busy || !!r.pendingEvent;
  if (r.l1?.encounter) near.unshift({ tag: U("danger"), label: U("entityRetreat"), verb: U("retreat"), run: () => act({ type: "avoidEntity" }) });
  const toggleHints = () => { const h = !hints; setHints(h); ctx.view!.setHints(h); };
  const logLines = (n: number) => r.log.slice(-n).map((l, k, a) => <p key={r.log.length - a.length + k} class={(k < a.length - 1 ? "old " : "") + (l.kind ?? "")}>{L(l.t)}</p>);
  const actionBar = (
    <div class="bar">
      <button disabled={lock} onClick={() => act({ type: "turn", dir: 2 })}>{U("back_")}<small>1′</small></button>
      <button disabled={lock} onClick={() => setSheet({ kind: "search" })}>{U("search")}<small>15–30′</small></button>
      <button disabled={lock} onClick={() => setSheet({ kind: "rest" })}>{U("rest")}<small>2–8h</small></button>
      {r.level === "level-1" && <button disabled={lock} onClick={() => act({ type: "wait" })}>{U("waitLights")}<small>5′</small></button>}
      <button aria-pressed={hints} onClick={toggleHints}>{U("hints")}<small>{hints ? U("on") : U("off")}</small></button>
    </div>);
  const menuBar = (
    <div class="bar">
      <button onClick={() => setSheet({ kind: "bag" })}>{U("bag")}<small>{g.weight().toFixed(1)}/{CARRY}</small></button>
      <button onClick={() => setSheet({ kind: "notes" })}>{U("notes")}<small>{ctx.meta.clues.length}</small></button>
      <button onClick={() => setSheet({ kind: "map" })}>{U("map")}<small>{g.has("notebook") ? "✎" : "—"}</small></button>
      <button onClick={() => setSheet({ kind: "body" })}>{U("body")}<small>{feel.length ? "!" : "—"}</small></button>
    </div>);

  return (
    <div class="game">
      <div class="stage" ref={stage}>
        <canvas ref={canvas} aria-label={L({ zh: "場景。點開口移動，拖曳轉頭。", en: "The scene. Tap an opening to move; drag to look around." })} />
        <div class="labels" ref={labels} />
        <div class="top">
          <span class="chip" title={U("time")} onClick={() => setSheet({ kind: "body" })}><b>{timeText}</b>{delta && <span key={delta.id} class="delta">{delta.text}</span>}</span>
          {g.has("flashlight") && <button class="chip" disabled={lock} aria-pressed={r.flashlightOn} onClick={() => act({ type: "toggleFlashlight" })}>{U(r.flashlightOn ? "flashlightOff" : "flashlightOn")}</button>}
          {DEV && <select class="chip" aria-label="dev" onChange={e => { const v = (e.target as HTMLSelectElement).value as Parameters<Game["devJump"]>[0]; (e.target as HTMLSelectElement).value = ""; if (!v) return; g.devJump(v); ctx.view!.attach(g); ctx.audio.ambience(g); save(); rerender(); }}>
            <option value="">dev ▾</option><option value="manila">曼尼拉房間 Manila</option><option value="red">紅房間 red room</option><option value="flicker">閃爍牆 flicker wall</option><option value="outage">停電 outage</option><option value="day">+24h</option><option value="level1">Level 1</option><option value="alpha">Base Alpha</option>
          </select>}
          {feel.map((f, k) => <span key={k} class={`chip feel l${f.level}`} title={f[lang()]} onClick={() => setSheet({ kind: "body" })}>{ICON[f.id]}</span>)}
        </div>
        <button class="turn l" disabled={lock} aria-label={U("left")} onClick={() => act({ type: "turn", dir: -1 })}>‹<small>{U("left")}</small></button>
        <button class="turn r" disabled={lock} aria-label={U("right")} onClick={() => act({ type: "turn", dir: 1 })}>›<small>{U("right")}</small></button>
        {skip && <div key={skip.id} class="skip" style={{ animationDuration: skip.ms + "ms" }} aria-live="polite"><span>{L(skip.text)}</span></div>}
        {r.l1?.encounter && <div class="threat" role="alert"><p>{L(ctx.content.hazards[0].text[r.l1.encounter.phase === "noticed" ? (g.hasLight() ? "noticedLit" : "noticedDark") : "approaching"])}</p><button onClick={() => { setSheet(null); act({ type: "avoidEntity" }); }}>{U("entityRetreat")}</button></div>}
        <div class="over">
          {!lock && near.length > 0 && <div class="near">{near.map((n, k) => <button key={k} onClick={n.run}><span>{n.tag}</span>{n.label}<b>{n.verb}</b></button>)}</div>}
          {caption && <div class="cap" aria-live="polite">{L(caption)}</div>}
          <div class="say" onClick={() => setSheet({ kind: "log" })} aria-live="polite">{log.map((l, k) => <p key={r.log.length - log.length + k} class={(k < log.length - 1 ? "old " : "") + (l.kind ?? "")}>{L(l.t)}</p>)}</div>
        </div>
      </div>
      <div class="controls">{actionBar}{menuBar}</div>
      <div class="side"><div class="log">{logLines(14)}</div><button class="log-more" onClick={() => setSheet({ kind: "log" })}>{U("log")}</button>{actionBar}{menuBar}</div>
      {ev && <div class="sheet"><div class="card" role="dialog">
        <p class="story">{L(g.eventText(ev.id))}</p>
        {g.availableChoices(ev.id).map(({ ch, ok }, k) => <button class="opt" disabled={!ok} onClick={() => act({ type: "choose", index: k })}>{L(ch.text)}{!ok && ch.requires ? <small>{U("needs", { x: L(g.item(ch.requires.item).name) })}</small> : ch.effects?.time ? <small>{U("minutes", { m: ch.effects.time })}</small> : null}</button>)}
      </div></div>}
      {sheet && <Panel sheet={sheet} close={() => setSheet(null)} act={(cmd, keep) => { if (!keep) setSheet(null); act(cmd); }} setSheet={setSheet} />}
    </div>
  );
}

/* ---------- panels ---------- */
function Panel({ sheet, close, act, setSheet }: { sheet: NonNullable<Sheet>; close: () => void; act: (c: Command, keep?: boolean) => void; setSheet: (s: Sheet) => void }) {
  const g = ctx.game!, r = g.run;
  const card = (title: string, body: preact.ComponentChildren) => (
    <div class="sheet" onClick={e => { if (e.target === e.currentTarget) close(); }}><div class="card" data-panel={sheet.kind} role="dialog" aria-label={title}><h3>{title}<button class="x" onClick={close}>{U("close")}</button></h3>{body}</div></div>);
  const opt = (label: string, note: string, run: () => void, disabled = false) => <button class="opt" disabled={disabled} onClick={run}>{label}<small>{note}</small></button>;
  switch (sheet.kind) {
    case "elder": return card(L(g.elder.text.name), <>
      <p class="story">{L(r.log.at(-1)?.t ?? g.elder.text.first)}</p>
      {g.elderChoices().map(ch => <button class="opt" key={ch.id} onClick={() => act({ type: "elderChoice", id: ch.id }, true)}>{L(ch.text)}</button>)}
      <button class="opt" onClick={close}>{U("close")}</button>
    </>);
    case "crate": return card(U("supplyCrate"), <SupplyCratePanel id={sheet.id} act={cmd => act(cmd, true)} />);
    case "roomPerson": return card(L(g.personQuest.text.name), <RoomPersonPanel act={cmd => act(cmd, true)} close={close} />);
    case "lockedPack": return card(L(g.packPuzzle.text.name), <LockedPackPanel act={cmd => act(cmd, true)} />);
    case "search": {
      const flasks = r.inv.filter(x => x.bottle?.liquid === "empty");
      return card(U("search"), <>
        {opt(U("searchArea"), U("minutes", { m: 30 }), () => act({ type: "search" }))}
        {g.canWring() && opt(U("wring"), U("minutes", { m: 15 }), () => setSheet({ kind: "wring" }))}
        {flasks.length === 0 && g.canWring() && <p class="muted small">{L({ zh: "沒有空的保溫瓶，只能直接用手接著喝。", en: "No empty flask: you can only drink it from your hands." })}</p>}
      </>);
    }
    case "wring": {
      const flasks = r.inv.filter(x => x.bottle?.liquid === "empty");
      return card(U("wring"), <>
        <p class="story">{L(ctx.content.liquids.find(x => x.id === "carpet_water")!.look)}。{L({ zh: "Level 0 地毯裡的水已經被污染了。", en: "The water in Level 0's carpet is contaminated." })}</p>
        {flasks.map(f => opt(U("wringInto", { x: L(g.itemName(f)) }), U("minutes", { m: 15 }), () => act({ type: "wring", into: f.key })))}
        {opt(U("wringHands"), U("minutes", { m: 15 }), () => act({ type: "wring" }))}
      </>);
    }
    case "rest": return card(U("rest"), <>
      <p class="muted small">{U("restHint")}</p>
      {[2, 4, 8].map(h => opt(U("restFor", { h }), "", () => act({ type: "rest", hours: h })))}
    </>);
    case "pit": return card(U("pit"), <>
      <p class="muted small">{U("pitWarn")}</p>
      {opt(U("pitLook"), U("minutes", { m: 2 }), () => act({ type: "pit", jump: false }))}
      {opt(U("pitJump"), "", () => act({ type: "pit", jump: true }))}
    </>);
    case "ceiling": return card(U("hole"), <>
      {g.has("crowbar") ? opt(U("ceilingCrowbar"), "", () => act({ type: "ceiling" })) : opt(U("ceilingHand"), "", () => act({ type: "ceiling" }))}
    </>);
    case "bag": return card(`${U("bag")} · ${g.weight().toFixed(1)} / ${CARRY}`, <Bag act={act} setSheet={setSheet} />);
    case "boil": {
      const flasks = r.inv.filter(x => x.bottle && x.bottle.liquid !== "empty");
      return card(U("chooseFlask"), <>{flasks.map(f => opt(L(g.itemName(f)), U("minutes", { m: 15 }), () => act({ type: "boil", salt: sheet.salt, target: f.key })))}</>);
    }
    case "body": {
      const f = feelings(r);
      return card(U("body"), <>
        {f.length ? f.map((x, k) => <p key={k} class="story">{x[lang()]}</p>) : <p class="story">{U("feelFine")}</p>}
        {g.has("watch") && <p class="muted small">{L({ zh: `醒來到現在：${Math.floor(r.time / H)} 小時`, en: `Since waking: ${Math.floor(r.time / H)} hours` })}</p>}
        {hasStatus(r, "hearing_damage") && <p class="muted small">{L({ zh: "聽力受損時，聲音和字幕都會變模糊。", en: "With damaged hearing, sounds and captions blur." })}</p>}
      </>);
    }
    case "notes": return card(U("notes"), <Notes />);
    case "map": return card(U("map"), <NotebookMap run={r} act={cmd => act(cmd, true)} />);
    case "log": return card(U("log"), <div class="story" style="display:flex;flex-direction:column;gap:6px">{r.log.slice(-40).map((l, k) => <p key={k} style="margin:0" class={l.kind === "warn" ? "warn" : ""}>{L(l.t)}</p>)}</div>);
    case "manila": return card(U("notesObj"), <Manila act={act} />);
    case "cabinet": return card(U("cabinet"), <Cabinet act={act} />);
  }
}

function Bag({ act, setSheet }: { act: (c: Command, keep?: boolean) => void; setSheet: (s: Sheet) => void }) {
  const g = ctx.game!, r = g.run, [open, setOpen] = useState<string | null>(null);
  if (!r.inv.length) return <p class="muted">{U("empty")}</p>;
  const inManila = g.zoneHere() === "manila";
  const acts = (x: InvItem) => {
    const it = g.item(x.id), b: [string, () => void][] = [];
    if (x.bottle && x.bottle.liquid !== "empty") { b.push([U("inspect") + " 5′", () => act({ type: "inspect", key: x.key }, true)]); b.push([U("sip"), () => act({ type: "drink", key: x.key, sip: true }, true)]); b.push([U("drink"), () => act({ type: "drink", key: x.key }, true)]); }
    else if (x.bottle) b.push([U("inspect"), () => act({ type: "inspect", key: x.key }, true)]);
    if (x.id === "almond_water") b.push([U("drink"), () => act({ type: "drink", key: x.key }, true)]);
    if (it.tags.includes("food")) b.push([U("eat"), () => act({ type: "eat", key: x.key }, true)]);
    if (x.id === "firesalt" && r.inv.some(y => y.bottle && y.bottle.liquid !== "empty")) b.push([U("boil"), () => setSheet({ kind: "boil", salt: x.key })]);
    if (x.id === "bandage") b.push([U("bandageUp"), () => act({ type: "bandage", key: x.key }, true)]);
    if (x.id === "notebook") b.push([U("map"), () => setSheet({ kind: "map" })]);
    if (inManila) b.push([U("putCabinet"), () => act({ type: "cabinetPut", key: x.key }, true)]);
    b.push([U("drop"), () => act({ type: "drop", key: x.key }, true)]);
    return b;
  };
  return <div class="list">{r.inv.map(x => (
    <div class="inv" key={x.key}>
      <div class="head" onClick={() => setOpen(open === x.key ? null : x.key)}><span>{L(g.itemName(x))}</span><span class="muted small">{U("weight")} {g.item(x.id).weight}</span></div>
      {open === x.key && <>
        <p class="muted small" style="margin:0">{x.bottle ? L(g.bottleLook(x.bottle)) : L(g.item(x.id).desc)}</p>
        <div class="acts">{acts(x).map(([l, f], k) => <button key={k} onClick={f}>{l}</button>)}</div>
      </>}
    </div>))}
    <p class="muted small">{L(ctx.game!.run.log[ctx.game!.run.log.length - 1]?.t ?? { zh: "", en: "" })}</p>
  </div>;
}

function Notes() {
  const [tab, setTab] = useState<"clues" | "manila">("clues"), m = ctx.meta;
  return <>
    <div class="tabs"><button aria-pressed={tab === "clues"} onClick={() => setTab("clues")}>{U("clues")}</button><button aria-pressed={tab === "manila"} onClick={() => setTab("manila")}>{U("manilaNotes")}</button></div>
    {tab === "clues" && (m.clues.length ? m.clues.map(id => { const c = ctx.content.clues.find(x => x.id === id); return c && <div class="inv" key={id}><b>{L(c.title)}</b><p class="story" style="margin:0">{L(c.text)}</p></div>; }) : <p class="muted">{U("noClues")}</p>)}
    {tab === "manila" && (m.notes.length ? <div class="paper">{m.notes.map((n, k) => <p key={k}>「{n.t}」<small>{L({ zh: `第 ${n.run} 次的你`, en: `You, awakening ${n.run}` })}</small></p>)}</div> : <p class="muted">{U("noClues")}</p>)}
  </>;
}

function Manila({ act }: { act: (c: Command, keep?: boolean) => void }) {
  const [text, setText] = useState(""), m = ctx.meta, c = (id: string) => ctx.content.clues.find(x => x.id === id)!;
  return <>
    <div class="paper">
      <p>{L(c("manila_guide").text)}<small>{L({ zh: "打字機打的，邊角被翻得很軟", en: "Typewritten, the corners worn soft" })}</small></p>
      <p>{L(c("reddish_rule").text)}<small>{L({ zh: "另一張，鉛筆寫的", en: "Another sheet, in pencil" })}</small></p>
      <p>{L(c("manila_hand").text)}</p>
      {[ctx.game!.personQuest.clues.aftermath, ctx.game!.personQuest.clues.promise, ctx.game!.personQuest.clues.waited].filter(id => m.clues.includes(id)).map(id => <p key={id}>{L(c(id).text)}</p>)}
      {m.notes.map((n, k) => <p key={k}>「{n.t}」<small>{L({ zh: `你留下的（第 ${n.run} 次）`, en: `Yours (awakening ${n.run})` })}</small></p>)}
    </div>
    <label class="small muted" for="note">{U("writeNote")}</label>
    <textarea id="note" rows={3} maxLength={200} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} />
    <button class="btn main" disabled={!text.trim()} onClick={() => { act({ type: "writeNote", text }, true); setText(""); }}>{U("leaveNote")}</button>
  </>;
}

function Cabinet({ act }: { act: (c: Command, keep?: boolean) => void }) {
  const g = ctx.game!, m = ctx.meta;
  return <>
    <p class="muted small">{L({ zh: "放進櫃子的東西，下一次醒來還會在。", en: "Whatever you leave here will still be here next time you wake." })}</p>
    {m.cabinet.length ? m.cabinet.map(x => <button class="opt" key={x.key} onClick={() => act({ type: "cabinetTake", key: x.key }, true)}>{L(g.itemName(x))}<small>{U("take")}</small></button>) : <p class="muted">{U("cabinetEmpty")}</p>}
    <h3 style="font-size:14px">{U("yourBag")}</h3>
    {g.run.inv.map(x => <button class="opt" key={x.key} onClick={() => act({ type: "cabinetPut", key: x.key }, true)}>{L(g.itemName(x))}<small>{U("putCabinet")}</small></button>)}
  </>;
}
export { edgeCells };
