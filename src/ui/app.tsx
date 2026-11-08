/* Screens: title → name (first time) → prep → play → ending → prep ... plus memories, sources and settings. */
import { useState } from "preact/hooks";
import { Game, PREP_CARRY, DISC } from "../core/game";
import { exportSave, importSave, persist, wipe } from "../state/save";
import { newMeta } from "../state/types";
import { ctx, L, U, save } from "./ctx";
import { Play } from "./play";

type Screen = "title" | "name" | "prep" | "play" | "codex" | "sources" | "settings";

export function App() {
  const [screen, setScreen] = useState<Screen>(ctx.game ? "title" : "title");
  const [ended, setEnded] = useState(false);
  const [, setTick] = useState(0); const rerender = () => setTick(x => x + 1);
  const go = (s: Screen) => { setEnded(false); setScreen(s); };
  const startRun = (bought: string[]) => {
    const m = ctx.meta;
    for (const id of bought) m.points -= ctx.content.items.find(x => x.id === id)!.prep!.cost;
    ctx.game = Game.newRun(ctx.content, m, (Math.random() * 1e9) | 0, bought);
    save(); go("play");
  };
  if (screen === "play" && ctx.game) return <>
    <Play key={ctx.game.run.seed} onEnd={() => { save(); setEnded(true); }} />
    {ended && <End again={() => { ctx.game = null; go("prep"); }} title={() => { ctx.game = null; go("title"); }} />}
  </>;
  if (screen === "name") return <Name done={() => go("prep")} />;
  if (screen === "prep") return <Prep start={startRun} back={() => go("title")} />;
  if (screen === "codex") return <Codex back={() => go("title")} />;
  if (screen === "sources") return <Sources back={() => go("title")} />;
  if (screen === "settings") return <Settings back={() => { rerender(); go("title"); }} />;
  return <Title cont={ctx.game && !ctx.game.run.ended ? () => go("play") : null} wake={() => go(ctx.meta.name ? "prep" : "name")} go={go} />;
}

function Title({ cont, wake, go }: { cont: (() => void) | null; wake: () => void; go: (s: Screen) => void }) {
  const [, setT] = useState(0), m = ctx.meta;
  return <div class="screen"><div class="col">
    <h1>{U("title")}</h1>
    <p class="story">{U("tagline")}</p>
    <div class="seg" role="group" aria-label={U("lang")}>{(["zh", "en"] as const).map(l => <button aria-pressed={m.settings.lang === l} onClick={() => { m.settings.lang = l; save(); setT(x => x + 1); document.documentElement.lang = l === "zh" ? "zh-Hant" : "en"; }}>{l === "zh" ? "中文" : "English"}</button>)}</div>
    <div class="list">
      {cont && <button class="btn main" onClick={cont}>{U("continue")}<small>{U("wakeN", { n: ctx.game!.run.run })}</small></button>}
      <button class={"btn" + (cont ? "" : " main")} onClick={wake}>{U("newRun")}<small>{m.points} {U("memoryPts")}</small></button>
      <button class="btn" onClick={() => go("codex")}>{U("codex")}<small>{m.endings.length} · {m.discoveries.length}</small></button>
      <button class="btn" onClick={() => go("settings")}>{U("settings")}</button>
      <button class="btn" onClick={() => go("sources")}>{U("sources")}</button>
    </div>
    <p class="warnbox">{U("warning")}</p>
  </div></div>;
}

function Name({ done }: { done: () => void }) {
  const [v, setV] = useState("");
  const ok = () => { if (!v.trim()) return; ctx.meta.name = v.trim().slice(0, 24); save(); done(); };
  return <div class="screen"><div class="col">
    <h2>{U("namePrompt")}</h2>
    <input type="text" maxLength={24} value={v} onInput={e => setV((e.target as HTMLInputElement).value)} onKeyDown={e => e.key === "Enter" && ok()} autoFocus aria-label={U("namePrompt")} />
    <p class="small">{U("nameHint")}</p>
    <button class="btn main" disabled={!v.trim()} onClick={ok}>{U("nameOk")}</button>
  </div></div>;
}

function Prep({ start, back }: { start: (b: string[]) => void; back: () => void }) {
  const m = ctx.meta, items = ctx.content.items.filter(x => x.prep);
  const [pick, setPick] = useState<string[]>([]);
  const cost = pick.reduce((s, id) => s + items.find(x => x.id === id)!.prep!.cost, 0), weight = pick.reduce((s, id) => s + items.find(x => x.id === id)!.weight, 0);
  const toggle = (id: string, add: boolean) => setPick(p => add ? [...p, id] : (() => { const k = p.lastIndexOf(id); return p.filter((_, i) => i !== k); })());
  return <div class="screen"><div class="col">
    <h2>{U("wakeN", { n: m.runs + 1 })}</h2>
    <p>{U("prepHint")}</p>
    <div class="field"><span>{U("memoryPts")}</span><span class="pts">{m.points - cost} / {m.points}</span></div>
    <div class="field"><span>{U("carry")}</span><span>{weight} / {PREP_CARRY}</span></div>
    <div class="list">{items.map(it => {
      const n = pick.filter(x => x === it.id).length, canAdd = cost + it.prep!.cost <= m.points && weight + it.weight <= PREP_CARRY;
      return <div class="inv" key={it.id}>
        <div class="head"><span>{L(it.name)}{n > 0 && <b class="pts"> ×{n}</b>}</span><span class="muted small">{it.prep!.cost} · {U("weight")} {it.weight}</span></div>
        <p class="muted small" style="margin:0">{L(it.desc)}</p>
        <div class="acts"><button disabled={!canAdd} onClick={() => toggle(it.id, true)}>＋</button><button disabled={!n} onClick={() => toggle(it.id, false)}>－</button></div>
      </div>;
    })}</div>
    <button class="btn main" onClick={() => start(pick)}>{U("wake")}<small>{pick.length ? pick.map(id => L(items.find(x => x.id === id)!.name)).join("、") : U("nothing")}</small></button>
    <button class="btn" onClick={back}>{U("back")}</button>
  </div></div>;
}

function End({ again, title }: { again: () => void; title: () => void }) {
  const g = ctx.game!, e = g.run.ended!, def = ctx.content.endings.find(x => x.id === e.ending)!;
  return <div class={"end" + (e.ending === "closed_loop" ? " red" : "")} role="dialog"><div class="col">
    <h2>{L(def.title)}</h2>
    <p class="story">{L(e.level === "level-1" ? def.textByLevel?.["level-1"] ?? def.text : def.text)}</p>
    <h3 class="muted" style="font-weight:400;margin:6px 0 0">{U("endMemories")}</h3>
    <table><tbody>{e.breakdown.map((b, k) => <tr key={k}><td>{L(b.label)}</td><td>+{b.pts}</td></tr>)}<tr><td><b>{U("total")}</b></td><td><b>+{e.points}</b></td></tr></tbody></table>
    <p class="muted">{U("nowHave", { n: ctx.meta.points })}</p>
    <button class="btn main" onClick={again}>{U("againWake")}</button>
    <button class="btn" onClick={title}>{U("toTitle")}</button>
  </div></div>;
}

function Codex({ back }: { back: () => void }) {
  const m = ctx.meta, all = ctx.content.endings.filter(e => !e.legacy || m.endings.includes(e.id));
  return <div class="screen"><div class="col">
    <h2>{U("codex")}</h2>
    <h3 class="muted" style="font-weight:400;margin:0">{U("endings")} · {m.endings.length}/{all.length}</h3>
    <div class="list">{all.map(e => m.endings.includes(e.id) ? <div class="inv" key={e.id}><b>{L(e.title)}</b><p class="small muted" style="margin:0">{L(e.text)}</p></div> : <div class="inv muted" key={e.id}>{U("unknown")}</div>)}</div>
    <h3 class="muted" style="font-weight:400;margin:0">{U("discoveries")} · {m.discoveries.length}/{Object.keys(DISC).length}</h3>
    <div class="chiprow">{Object.keys(DISC).map(k => <span class="chip" key={k}>{m.discoveries.includes(k) ? L(DISC[k]) : U("unknown")}</span>)}</div>
    <h3 class="muted" style="font-weight:400;margin:0">{U("clues")}</h3>
    {m.clues.length ? m.clues.map(id => { const c = ctx.content.clues.find(x => x.id === id); return c && <div class="inv" key={id}><b>{L(c.title)}</b><p class="small" style="margin:0">{L(c.text)}</p></div>; }) : <p>{U("noClues")}</p>}
    {m.history.length > 0 && <><h3 class="muted" style="font-weight:400;margin:0">{U("history")}</h3>
      <div class="list">{m.history.slice(-12).reverse().map(h => <div class="field small" key={h.run}><span>#{h.run} · {L(all.find(x => x.id === h.ending)!.title)}</span><span class="pts">+{h.points}</span></div>)}</div></>}
    <button class="btn" onClick={back}>{U("back")}</button>
  </div></div>;
}

function Sources({ back }: { back: () => void }) {
  return <div class="screen"><div class="col">
    <h2>{U("sources")}</h2>
    <p>{U("license")}</p>
    <div class="list">{ctx.content.sources.map(s => <div class="inv" key={s.id}><a href={s.url} target="_blank" rel="noopener">{s.title}</a><span class="small muted">{s.authors}</span><span class="small">{L(s.used)}</span></div>)}</div>
    <p class="small"><a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a></p>
    <button class="btn" onClick={back}>{U("back")}</button>
  </div></div>;
}

function Settings({ back }: { back: () => void }) {
  const s = ctx.meta.settings, [, setT] = useState(0), [io, setIo] = useState(""), [msg, setMsg] = useState("");
  const set = (f: () => void) => { f(); save(); setT(x => x + 1); };
  const seg = <T extends string | boolean>(val: T, opts: [T, string][], f: (v: T) => void) => <div class="seg">{opts.map(([v, l]) => <button aria-pressed={val === v} onClick={() => set(() => f(v))}>{l}</button>)}</div>;
  return <div class="screen"><div class="col">
    <h2>{U("settings")}</h2>
    <div class="field"><span>{U("lang")}</span>{seg(s.lang, [["zh", "中文"], ["en", "English"]], v => { s.lang = v; })}</div>
    <div class="field"><span>{U("sound")}</span>{seg(s.sound, [[false, U("off")], [true, U("on")]], v => { s.sound = v; if (!ctx.audio.enable(v) && v) setMsg(U("soundOff")); })}</div>
    <div class="field"><span>{U("flash")}</span>{seg(s.flash, [[false, U("off")], [true, U("on")]], v => { s.flash = v; })}</div>
    <div class="field"><span>{U("motion")}</span>{seg(s.reduceMotion, [[false, U("off")], [true, U("on")]], v => { s.reduceMotion = v; })}</div>
    <div class="field"><span>{U("quality")}</span>{seg(s.quality, [["auto", U("auto")], ["low", U("low")], ["mid", U("mid")], ["high", U("high")]], v => { s.quality = v; })}</div>
    <p class="small">{U("exportHint")}</p>
    <div class="row"><button class="btn" onClick={() => setIo(exportSave(ctx.meta, ctx.game ? ctx.game.save() : null))}>{U("exportSave")}</button>
      <button class="btn" onClick={() => { try { const r = importSave(io); ctx.meta = r.meta; ctx.game = r.run ? new Game(ctx.content, r.meta, r.run) : null; persist(ctx.meta, r.run); setMsg("✓"); } catch { setMsg(U("importBad")); } }}>{U("importOk")}</button></div>
    <textarea rows={4} value={io} onInput={e => setIo((e.target as HTMLTextAreaElement).value)} aria-label={U("importSave")} />
    {msg && <p class="small">{msg}</p>}
    <button class="btn" onClick={() => { if (confirm(U("wipeConfirm"))) { wipe(); ctx.meta = newMeta(); ctx.game = null; setT(x => x + 1); } }}>{U("wipe")}</button>
    <button class="btn main" onClick={back}>{U("back")}</button>
  </div></div>;
}
