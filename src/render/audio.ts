/* Sound, synthesised with Web Audio (no files), and the captions that go with it. Captions are produced even
   with sound off (phones are often muted; deaf players). Hearing damage muffles both. */
import { sstep, T, type Text } from "../core/types";
import type { Game } from "../core/game";
import { edgeCells } from "../world/level0";
import { hasStatus } from "../systems/survival";
import { pianoLevels, PIANO_AUDIBLE, PIANO_CAPTION } from "../systems/hallucinations";

type N = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const TUNE: [number, number][] = [[57, 1], [64, 1], [60, 2], [59, 1], [57, 1], [52, 2], [0, 1], [53, 1], [57, 1], [60, 2], [59, 1.5], [55, .5], [57, 3], [0, 2]];

export class Audio {
  ctx: AudioContext | null = null; on = false; n: N = {};
  lv = { hum: 0, piano: 0, cut: 900, drone: 0, buzz: 0, fl: 0 };
  onCaption: (t: Text) => void = () => {};
  private capState: Record<string, boolean> = {}; private pianoAt = 0; private pianoIdx = 0; private muffled = false;

  constructor() { setInterval(() => this.pianoTick(), 200); }
  enable(on: boolean): boolean {
    if (on && !this.ctx) { try { this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); this.build(); } catch { this.ctx = null; return false; } }
    this.on = on; if (this.ctx) { if (on) this.ctx.resume(); this.n.master.gain.setTargetAtTime(on ? .9 : 0, this.ctx.currentTime, .3); }
    return true;
  }
  private build() {
    const C = this.ctx!, N = this.n;
    const gain = (v: number, to?: AudioNode) => { const g = C.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
    const filt = (type: BiquadFilterType, f: number, q: number, to?: AudioNode) => { const b = C.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (to) b.connect(to); return b; };
    const osc = (type: OscillatorType, f: number, to: AudioNode) => { const o = C.createOscillator(); o.type = type; o.frequency.value = f; o.connect(to); o.start(); return o; };
    N.out = filt("lowpass", 18000, .5, C.destination);           // hearing damage closes this down
    N.master = gain(0, N.out);
    const len = Math.floor(C.sampleRate * 2.4), ir = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    N.verb = C.createConvolver(); N.verb.buffer = ir; N.verb.connect(gain(.35, N.master));
    N.noise = C.createBuffer(1, C.sampleRate * 2, C.sampleRate); const nd = N.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const loopNoise = () => { const s = C.createBufferSource(); s.buffer = N.noise; s.loop = true; s.start(); return s; };
    N.hum = gain(0, N.master); N.humF = filt("lowpass", 650, .7, N.hum);
    N.h1 = osc("sawtooth", 120, gain(.2, N.humF)); N.h2 = osc("sine", 60, gain(.45, N.humF)); osc("sine", 240.6, gain(.05, N.humF));
    loopNoise().connect(filt("bandpass", 5200, 1.2, gain(.03, N.hum)));
    N.crk = gain(0, N.master); loopNoise().connect(filt("highpass", 1800, .5, N.crk));
    N.drone = gain(0, N.master); const df = filt("lowpass", 180, .5, N.drone); osc("sine", 41, df); osc("sine", 41.6, df); osc("triangle", 55.2, gain(.3, df));
    N.buzz = gain(0, N.master); osc("square", 180, filt("lowpass", 900, 2, N.buzz));
    N.piano = gain(0, N.master); N.piano.connect(N.verb); N.pianoF = filt("lowpass", 900, .5, N.piano);
  }
  private pnote(m: number, t: number, v: number) {
    const C = this.ctx!, f = 440 * Math.pow(2, (m - 69) / 12) * (1 + (Math.random() - .5) * .006);
    const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .006); g.gain.exponentialRampToValueAtTime(v * .3, t + .4); g.gain.exponentialRampToValueAtTime(.0008, t + 3.2); g.connect(this.n.pianoF);
    for (const [type, mul, amp] of [["triangle", 1, 1], ["sine", 2.003, .35], ["sine", 3.01, .12]] as const) { const o = C.createOscillator(); o.type = type; o.frequency.value = f * mul; const og = C.createGain(); og.gain.value = amp; o.connect(og); og.connect(g); o.start(t); o.stop(t + 3.3); }
  }
  private pianoTick() {
    if (!this.on || !this.ctx || this.lv.piano < .01) return;
    const C = this.ctx; if (this.pianoAt < C.currentTime) this.pianoAt = C.currentTime + .1;
    while (this.pianoAt < C.currentTime + .6) {
      const [m, b] = TUNE[this.pianoIdx];
      if (m) this.pnote(m, this.pianoAt, .22); if (this.pianoIdx % 4 === 0) this.pnote((m || 57) - 24, this.pianoAt, .1);
      this.pianoAt += b * .78; this.pianoIdx = (this.pianoIdx + 1) % TUNE.length;
    }
  }
  private burst(t: number, dur: number, type: BiquadFilterType, f: number, q: number, vol: number) {
    const C = this.ctx!, s = C.createBufferSource(), b = C.createBiquadFilter(), g = C.createGain();
    s.buffer = this.n.noise; b.type = type; b.frequency.value = f; b.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    s.connect(b); b.connect(g); g.connect(this.n.master); g.connect(this.n.verb); s.start(t, Math.random() * 1.5); s.stop(t + dur + .05);
  }
  private thump(t: number, f: number, dur: number, vol: number) {
    const C = this.ctx!, o = C.createOscillator(), g = C.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * .5, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    o.connect(g); g.connect(this.n.master); o.start(t); o.stop(t + dur + .05);
  }
  step(surface: "carpet" | "water" | "wood" | "sticky", n: number) {
    if (!this.on || !this.ctx) return; const t0 = this.ctx.currentTime + .12;
    for (let k = 0; k < n; k++) {
      const t = t0 + k * .34 + Math.random() * .03;
      if (surface === "water") { this.burst(t, .18, "bandpass", 900 + Math.random() * 400, 1.2, .22); this.burst(t + .06, .25, "bandpass", 2200, 2, .08); }
      else if (surface === "wood") { this.burst(t, .07, "bandpass", 520, 1.5, .3); this.thump(t, 95, .12, .22); }
      else { this.burst(t, .09, "lowpass", 420, .7, .28); if (surface === "sticky") this.burst(t + .1, .03, "highpass", 3000, .7, .07); }
    }
  }
  sfx(name: string) {
    if (!this.on || !this.ctx) return; const C = this.ctx, t = C.currentTime;
    if (name === "creak") {
      const o = C.createOscillator(), b = C.createBiquadFilter(), g = C.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(38, t); o.frequency.linearRampToValueAtTime(64, t + .5); o.frequency.linearRampToValueAtTime(30, t + .9);
      b.type = "bandpass"; b.frequency.value = 1100; b.Q.value = 6;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .06); g.gain.linearRampToValueAtTime(.1, t + .7); g.gain.linearRampToValueAtTime(0, t + 1);
      o.connect(b); b.connect(g); g.connect(this.n.master); g.connect(this.n.verb); o.start(t); o.stop(t + 1.05); this.thump(t + .95, 70, .25, .18);
    } else if (name === "rattle") { for (let k = 0; k < 4; k++) { this.burst(t + k * .11, .05, "bandpass", 2600 + Math.random() * 600, 4, .3); this.thump(t + k * .11, 140, .06, .12); } }
    else if (name === "clunk") { this.thump(t, 70, .5, .55); this.burst(t, .25, "lowpass", 300, .7, .35); }
    else if (name === "relight") { for (let k = 0; k < 5; k++) this.burst(t + k * .2 + Math.random() * .06, .03, "highpass", 2500, .7, .18); }
    else if (name === "paper") { this.burst(t, .12, "highpass", 3500, .5, .08); this.burst(t + .1, .1, "highpass", 4200, .5, .05); }
    else if (name === "distant_steps") { for (let k = 0; k < 3; k++) this.thump(t + k * .58, 68, .16, .035); }
    else if (name === "distant_knocks") { this.thump(t, 125, .1, .045); this.thump(t + .42, 125, .1, .04); }
    else if (name === "whoosh") this.burst(t, 1.2, "lowpass", 600, .5, .5);
    else if (name === "spike") { const o = C.createOscillator(), g = C.createGain(); o.type = "sawtooth"; o.frequency.value = 2400; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12, t + .3); g.gain.linearRampToValueAtTime(0, t + 2.5); o.connect(g); g.connect(this.n.master); o.start(t); o.stop(t + 2.6); }
    else if (name === "end") { this.n.hum.gain.setTargetAtTime(0, t, .3); this.n.piano.gain.setTargetAtTime(0, t, .3); }
  }
  /** Every spoken caption takes the same hearing-damage path, even with sound disabled. */
  caption(text: Text, g: Game) { this.onCaption(hasStatus(g.run, "hearing_damage") ? muffle(text) : text); }

  /** Follow where you stand. Captions appear once when something becomes audible. */
  ambience(g: Game) {
    const { i, j } = g.run.pos, w = g.world, z = w.zone(i, j), inM = z === "manila";
    const dm = w.manilaDist(i, j), dr = w.redDist(i, j);
    let lit = 0, fl = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const c = w.cells.get((i + di) + "," + (j + dj)); const p = c?.panel; if (p && p !== "dead" && !p.red && !w.inManila(c!.i, c!.j)) { lit++; if (p.flick) fl++; } }
    const pw = g.run.outageLeft ? 0 : 1, piano = pianoLevels(g.run, w), redK = 1 - sstep(.8, 3.2, dr);
    this.muffled = hasStatus(g.run, "hearing_damage");
    const lv = { hum: inM ? 0 : (.03 + .035 * lit) * pw * sstep(1.2, 4.5, dm), piano: piano.piano, cut: piano.cut, drone: .32 * redK, buzz: 0, fl: fl * pw };
    if (w.flickerKey) { const [[a, b], [c, d]] = edgeCells(w.flickerKey); lv.buzz = .05 * (1 - sstep(.5, 3.5, Math.hypot((a + c) / 2 - i, (b + d) / 2 - j))); }
    this.lv = lv;
    const st = { inM, piano: lv.piano > PIANO_AUDIBLE, red: redK > .25, buzz: lv.buzz > .008, crk: fl > 0 && pw > 0 };
    const say = (t: Text) => this.caption(t, g);
    if (inM && !this.capState.inM) say(T("〔嗡嗡聲停了。鋼琴聲很清楚〕", "[The hum stops. The piano is clear]"));
    else if (!inM && this.capState.inM) say(T("〔嗡嗡聲又回來了〕", "[The hum is back]"));
    else if (!inM && st.piano && !this.capState.piano) say(PIANO_CAPTION);
    else if (redK > .4 && !this.capState.red) say(T("〔嗡嗡聲變得又低又悶〕", "[The hum sinks low and dull]"));
    else if (lv.buzz > .015 && !this.capState.buzz) this.onCaption(this.muffled   // tell them what the ringing cost them
      ? T("〔你好像聽到了什麼，但耳鳴把它蓋過去了〕", "[You think you hear something, but the ringing drowns it out]")
      : T("〔細細的電流聲〕", "[A thin electric buzz]"));
    else if (st.crk && !this.capState.crk) say(T("〔燈管劈啪作響〕", "[A tube crackles]"));
    this.capState = st;
    if (!this.ctx) return;
    const n = this.n, now = this.ctx.currentTime, set = (p: AudioParam, v: number, tc: number) => p.setTargetAtTime(v, now, tc);
    set(n.out.frequency, this.muffled ? 700 : 18000, .5);
    set(n.hum.gain, lv.hum, pw ? .7 : .25);
    set(n.h1.frequency, pw ? 120 - 22 * redK : 70, .5); set(n.h2.frequency, pw ? 60 - 11 * redK : 35, .5);
    set(n.humF.frequency, 650 - 320 * redK, .8);
    set(n.piano.gain, lv.piano, 1.2); set(n.pianoF.frequency, lv.cut, 1.2); set(n.drone.gain, lv.drone, 1.5); set(n.buzz.gain, this.muffled ? 0 : lv.buzz, .8);
  }
  crackle(v: number) { if (this.on && this.ctx) this.n.crk.gain.setTargetAtTime(this.lv.fl ? v : 0, this.ctx.currentTime, .03); }
}
/* hearing damage: captions lose pieces */
export function muffle(t: Text): Text {
  const m = (s: string) => [...s].map((ch, k) => (k % 3 === 1 && !/[〔〕[\]]/.test(ch) ? "…" : ch)).join("");
  return { zh: m(t.zh), en: m(t.en) };
}
