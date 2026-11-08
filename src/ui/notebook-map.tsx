/* A paper drawing of remembered cells. This component never reads the live world. */
import { useRef, useState } from "preact/hooks";
import type { Command } from "../core/game";
import { hashWith } from "../core/rng";
import type { MapCell, MapEdge, MapKey, MapMark, RunState } from "../state/types";
import { mapKey, mapOpacity, notebookReadBlock } from "../systems/notebook";
import { H } from "../systems/survival";
import { U } from "./ctx";

type Act = (cmd: Command) => void;
const EDGE_PATH = ["M -.5,-.5 H .5", "M .5,-.5 V .5", "M .5,.5 H -.5", "M -.5,.5 V -.5"];
const MARK_SYMBOL = { water: "≈", danger: "!", exit: "?", custom: "✎" };

function markLabel(mark: MapMark): string {
  return mark.kind === "custom" ? mark.text : U(mark.kind === "water" ? "mapWater" : mark.kind === "danger" ? "mapDanger" : "mapExit");
}
function zoneLabel(cell: MapCell): string {
  switch (cell.zone) {
    case "unknown": return U("mapUnknown");
    case "arch": return U("mapArch");
    case "manila": return cell.visited ? U("mapManila") : U("mapRoom");
    case "pillar": return U("mapPillar");
    case "dark": return U("mapDark");
    case "pit": return U("mapPit");
    case "red": return U("mapRed");
    default: return U("mapHall");
  }
}
function recordedAt(r: RunState, cell: MapCell): string {
  if (r.inv.some(x => x.id === "watch")) {
    const t = r.clock0 + cell.t, clock = t % (24 * H);
    return U("mapRecordedAt", { d: Math.floor(t / (24 * H)) + 1,
      time: `${String(Math.floor(clock / H)).padStart(2, "0")}:${String(clock % H).padStart(2, "0")}` });
  }
  const age = r.time - cell.t;
  return U(age < H ? "mapFresh" : age < 8 * H ? "mapOlder" : "mapFaded");
}

function Edge({ edge, d }: { edge: MapEdge; d: number }) {
  if (edge === "open") return null;
  if (edge === "unknown") return <path class="map-unknown-edge" d={EDGE_PATH[d]} />;
  if (edge === "wall") return <path class="map-wall" d={EDGE_PATH[d]} />;
  // Rotation gives every remembered door/flicker exactly the same glyph, regardless of its source.
  return <g transform={`rotate(${d * 90})`} class={`map-edge map-${edge}`}>
    {edge === "flicker" ? <path d="M -.5,-.5 H -.25 L -.15,-.58 L -.04,-.42 L .07,-.58 L .18,-.5 H .5" />
      : <>
        <path d="M -.5,-.5 H -.23 M .23,-.5 H .5" />
        {edge === "arch" ? <path class="map-arch-opening" d="M -.23,-.5 Q 0,-.24 .23,-.5" />
          : edge === "door" ? <path d="M -.23,-.5 H .23" class="map-door-leaf" />
          : <path d="M -.23,-.5 V -.12 M .23,-.5 Q .23,-.12 -.23,-.12" class="map-door-swing" />}
      </>}
  </g>;
}

export function NotebookMap({ run: r, act }: { run: RunState; act: Act }) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: r.pos.i, y: r.pos.j, span: 7 });
  const [selected, setSelected] = useState<MapKey | null>(null);
  const [custom, setCustom] = useState("");
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number; scale: number; moved: boolean } | null>(null);
  const hasNotebook = r.inv.some(x => x.id === "notebook");
  const cell = selected ? r.map[selected] : undefined, mark = selected ? r.mapMarks[selected] : undefined;
  const block = notebookReadBlock(r);
  const zoom = (factor: number) => setView(v => ({ ...v, span: Math.max(4, Math.min(32, v.span * factor)) }));
  const select = (key: MapKey) => { setSelected(key); const m = r.mapMarks[key]; setCustom(m?.kind === "custom" ? m.text : ""); };
  const setMark = (value: MapMark | null) => { if (selected) act({ type: "mapMark", key: selected, mark: value }); };
  const choosePoint = (x: number, y: number) => {
    const matrix = svg.current?.getScreenCTM(); if (!matrix) return;
    const p = new DOMPoint(x, y).matrixTransform(matrix.inverse()), key = mapKey(Math.round(p.x), Math.round(p.y));
    if (Object.hasOwn(r.map, key)) select(key);
  };

  if (!hasNotebook) return <p class="story">{U("mapMissing")}</p>;
  return <div class="notebook">
    <p class="muted small map-hint">{U("mapHint")}</p>
    <div class="map-tools" aria-label={U("mapControls")}>
      <button type="button" onClick={() => zoom(.8)} aria-label={U("mapZoomIn")}>＋</button>
      <button type="button" onClick={() => zoom(1.25)} aria-label={U("mapZoomOut")}>−</button>
      <button type="button" onClick={() => setView(v => ({ ...v, x: r.pos.i, y: r.pos.j }))}>{U("mapCenter")}</button>
      <span class="small muted">↑ {U("mapNorth")}</span>
    </div>
    <div class="map-viewport">
      <svg ref={svg} viewBox={`${view.x - view.span / 2} ${view.y - view.span / 2} ${view.span} ${view.span}`}
        aria-label={U("mapDrawing")} onWheel={e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15); }}
        onPointerDown={e => {
          if (!e.isPrimary || e.button !== 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: view.x, cy: view.y,
            scale: view.span / Math.min(rect.width, rect.height), moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }} onPointerMove={e => {
          const p = drag.current; if (!p || p.id !== e.pointerId) return;
          const dx = e.clientX - p.x, dy = e.clientY - p.y;
          if (Math.hypot(dx, dy) > 6) p.moved = true;
          if (p.moved) setView(v => ({ ...v, x: p.cx - dx * p.scale, y: p.cy - dy * p.scale }));
        }} onPointerUp={e => {
          const p = drag.current; if (!p || p.id !== e.pointerId) return;
          if (!p.moved) choosePoint(e.clientX, e.clientY);
          drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId);
        }} onPointerCancel={() => { drag.current = null; }}>
        <title>{U("mapDrawing")}</title>
        {Object.entries(r.map).map(([key, memory]) => {
          const [i, j] = key.split(",").map(Number), entryKey = key as MapKey, note = r.mapMarks[entryKey];
          const angle = memory.messy ? (hashWith(r.seed, i, j, memory.ver, 801) - .5) * 6 : 0;
          const skew = memory.messy ? (hashWith(r.seed, i, j, memory.ver, 802) - .5) * 5 : 0;
          const zone = memory.zone === "manila" && !memory.visited ? "hall" : memory.zone;
          return <g key={key} transform={`translate(${i} ${j})`}>
            <g opacity={mapOpacity(r.time, memory.t)} transform={`rotate(${angle}) skewX(${skew})`}>
              <rect class={`map-cell zone-${zone}`} x={-.49} y={-.49} width={.98} height={.98} />
              {memory.walls.map((edge, d) => <Edge key={d} edge={edge} d={d} />)}
              {zone === "arch" && <text class="map-zone" x={0} y={.12}>∩</text>}
              {zone === "manila" && <text class="map-zone" x={0} y={.12}>M</text>}
              {zone === "unknown" && <text class="map-zone" x={.28} y={.35}>?</text>}
              {memory.messy && <path class="map-scribble" d="M -.36,.28 l .12,-.05 .06,.07 .14,-.06 .17,.04" />}
            </g>
            {note && <text class={`map-mark mark-${note.kind}`} x={.26} y={-.12}>{MARK_SYMBOL[note.kind]}</text>}
            <rect class={`map-target${selected === key ? " selected" : ""}`} x={-.47} y={-.47} width={.94} height={.94}
              role="button" tabIndex={0} aria-label={`${zoneLabel(memory)}${memory.messy ? ", " + U("mapMessy") : ""}${note ? ", " + markLabel(note) : ""}`}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(entryKey); } }}>
              <title>{zoneLabel(memory)}{memory.messy ? " · " + U("mapMessy") : ""}{note ? " · " + markLabel(note) : ""}</title>
            </rect>
          </g>;
        })}
        <g transform={`translate(${r.pos.i} ${r.pos.j}) rotate(${r.pos.d * 90})`} class="map-player" aria-label={U("mapYou")}>
          <path d="M 0,-.3 L .19,.21 L 0,.12 L -.19,.21 Z" /><title>{U("mapYou")}</title>
        </g>
      </svg>
    </div>
    <div class="map-legend small"><span>▲ {U("mapYou")}</span><span>━ {U("mapWall")}</span><span>▰ {U("mapDoor")}</span><span>∩ {U("mapArch")}</span><span>M {U("mapManila")}</span><span>⌁ {U("mapFlicker")}</span><span>? {U("mapUnknown")}</span></div>
    {Object.values(r.map).some(c => c.messy) && <p class="small map-messy">{U("mapMessyHint")}</p>}
    {cell ? <div class="map-edit">
      <p class="small"><b>{zoneLabel(cell)}</b> · {U(cell.visited ? "mapVisited" : "mapSeen")}{cell.messy && <span class="map-messy"> · {U("mapMessy")}</span>}</p>
      <p class="small muted">{recordedAt(r, cell)}</p>
      {mark && <p class="map-note">{markLabel(mark)}</p>}
      <div class="map-mark-tools">{(["water", "danger", "exit"] as const).map(kind => <button type="button" key={kind}
        aria-pressed={mark?.kind === kind} onClick={() => setMark({ kind })}>{markLabel({ kind })}</button>)}
        <button type="button" disabled={!mark} onClick={() => { setMark(null); setCustom(""); }}>{U("mapErase")}</button>
      </div>
      <form onSubmit={e => { e.preventDefault(); if (custom.trim()) setMark({ kind: "custom", text: custom }); }}>
        <label for="map-custom" class="small muted">{U("mapCustom")}</label>
        <div class="map-custom-row"><input type="text" id="map-custom" maxLength={20} value={custom}
          onInput={e => setCustom(e.currentTarget.value)} /><button type="submit" disabled={!custom.trim()}>{U("mapSaveMark")}</button></div>
      </form>
    </div> : <p class="muted small">{U("mapSelect")}</p>}
    <button class="opt" disabled={!!block || !!r.pendingEvent} onClick={() => act({ type: "rereadNotebook" })}>
      {U("mapReread")}<small>{U("minutes", { m: 10 })}</small>
    </button>
    <p class="muted small">{U(block === "cooldown" ? "mapReadCooldown" : block === "calm" ? "mapReadCalm" : block === "blank" ? "mapReadBlank" : "mapReadHint")}</p>
  </div>;
}
