/* Level 0 "Threshold": a grid of 4 m cells joined by edges (open, wall, arch, door ...).
   Everything is derived from (seed, coordinates, version) so any place can be rebuilt; only what the player
   changed is stored. Pure logic: no Three.js, no DOM. */
import { hashWith } from "../core/rng";
import { ck, DV, type Dir } from "../core/types";

export const S = 4;                                    // cell size in metres
export const VIEW = 8;                                 // logic view distance in cells (renderer draws at most this far)

export type Zone = "hall" | "arch" | "pillar" | "dark" | "pit" | "manila" | "red";
export type BottleColor = "grey" | "green" | "blue" | "reddish";
export interface Panel { int: number; warm: number; flick?: boolean; red?: boolean }
export interface Bottle { liquid: string; color: BottleColor; full: boolean; sealed: boolean; spoiled: boolean; boiled?: boolean }
export interface GroundItem { key: string; id: string; bottle?: Bottle; x: number; z: number }
export interface Cell {
  i: number; j: number; ver: number;
  panel: Panel | "dead" | null; hole: boolean; pits: [number, number][]; items: GroundItem[];
  searched: boolean; salt: boolean;          // salt: firesalt crystals in a corner
}
export type Edge = "open" | "wall" | "arch" | "flicker" | "fakeflicker" | "mwall" | "door-wood" | "door-metal" | "door-manila"
  | "door-wood-open" | "door-metal-open" | "door-manila-open";

export interface WorldData {                            // what is saved
  seed: number; manila: [number, number];
  cells: Cell[]; edges: [string, Edge][]; fixed: string[]; picked: string[]; opened: [string, number][];
  flickerKey: string | null; fakeKey: string | null; corpse: [number, number] | null;
}

export const isOpenDoor = (t?: string) => !!t && t.endsWith("-open");
export const passable = (t?: string) => t === "open" || t === "arch" || isOpenDoor(t);
export const traversable = (t?: string) => passable(t) || t === "door-wood" || t === "door-manila";
export const solid = (t?: string) => !!t && !passable(t);
export function edgeKey(i: number, j: number, d: Dir | number): string { return d === 1 ? `v:${i},${j}` : d === 3 ? `v:${i - 1},${j}` : d === 2 ? `h:${i},${j}` : `h:${i},${j - 1}`; }
export function edgeCells(k: string): [[number, number], [number, number]] {
  const [t, rest] = k.split(":"); const [i, j] = rest.split(",").map(Number);
  return t === "v" ? [[i, j], [i + 1, j]] : [[i, j], [i, j + 1]];
}

type Listener = (i: number, j: number) => void;

export class Level0 {
  readonly seed: number;
  manila: [number, number];
  cells: Map<string, Cell>;
  edges: Map<string, Edge>;
  fixed = new Set<string>();
  picked = new Set<string>();
  opened = new Map<string, number>();                   // door edge -> swing angle chosen when it was opened
  flickerKey: string | null = null;                    // the real flickering wall (exit to Level 1)
  fakeKey: string | null = null;                       // a hallucinated one
  corpse: [number, number] | null = null;              // where the previous run's body lies
  listeners: Listener[] = [];
  private coreCache = new Map<string, [number, number] | null>();

  constructor(seed: number, data?: WorldData) {
    this.seed = seed;
    const self = this;
    this.cells = new (class extends Map<string, Cell> { set(k: string, v: Cell) { super.set(k, v); self.emit(v.i, v.j); return this; } })();
    this.edges = new (class extends Map<string, Edge> {
      set(k: string, v: Edge) { if (this.get(k) !== v) { super.set(k, v); for (const [i, j] of edgeCells(k)) self.emit(i, j); } return this; }
    })();
    if (data) {
      this.manila = data.manila;
      for (const c of data.cells) this.cells.set(ck(c.i, c.j), c);
      for (const [k, v] of data.edges) this.edges.set(k, v);
      data.fixed.forEach(k => this.fixed.add(k)); data.picked.forEach(k => this.picked.add(k));
      data.opened.forEach(([k, a]) => this.opened.set(k, a));
      this.flickerKey = data.flickerKey; this.fakeKey = data.fakeKey; this.corpse = data.corpse;
    } else {
      this.manila = this.placeManila();
      // the start: a cell with two ways out
      this.edges.set(edgeKey(0, 0, 0), "open"); this.edges.set(edgeKey(0, 0, 1), "open");
      this.edges.set(edgeKey(0, 0, 2), "wall"); this.edges.set(edgeKey(0, 0, 3), "wall");
      for (const k of this.edges.keys()) this.fixed.add(k);
    }
  }
  toData(): WorldData {
    return { seed: this.seed, manila: this.manila, cells: [...this.cells.values()], edges: [...this.edges], fixed: [...this.fixed], picked: [...this.picked], opened: [...this.opened], flickerKey: this.flickerKey, fakeKey: this.fakeKey, corpse: this.corpse };
  }
  private emit(i: number, j: number) { for (const f of this.listeners) f(i, j); }
  hash(...n: number[]) { return hashWith(this.seed, ...n); }

  /* ---------- zones (fixed per seed, never shift) ---------- */
  private placeManila(): [number, number] {
    for (let k = 0; k < 200; k++) {
      const a = this.hash(k, 61) * Math.PI * 2, r = 9 + this.hash(k, 62) * 8;
      const i = Math.round(Math.cos(a) * r), j = Math.round(Math.sin(a) * r);
      let ok = true;
      for (let di = -1; di <= 2 && ok; di++) for (let dj = -1; dj <= 2 && ok; dj++) if (this.baseZone(i + di, j + dj) !== "hall") ok = false;
      if (ok) return [i, j];
    }
    return [10, -4];
  }
  inManila(i: number, j: number) { const [mi, mj] = this.manila; return i >= mi && i <= mi + 1 && j >= mj && j <= mj + 1; }
  manilaDoors(): Set<string> {
    const [i, j] = this.manila;     // one wooden door in each wall
    return new Set([`v:${i - 1},${j}`, `v:${i + 1},${j + 1}`, `h:${i + 1},${j - 1}`, `h:${i},${j + 1}`]);
  }
  baseZone(i: number, j: number): Zone {
    if (Math.abs(i) <= 1 && Math.abs(j) <= 1) return "hall";
    const n = this.hash(Math.floor(i / 5), Math.floor(j / 5), 77);
    return n < .1 ? "arch" : n < .24 ? "pillar" : n < .32 ? "dark" : n < .38 ? "pit" : "hall";
  }
  blockCore(bi: number, bj: number): [number, number] | null {     // at most one red room per 8×8 block
    const k = bi + "," + bj; if (this.coreCache.has(k)) return this.coreCache.get(k)!;
    let c: [number, number] | null = null;
    if (this.hash(bi, bj, 88) < .3) {
      const ci = bi * 8 + 1 + Math.floor(this.hash(bi, bj, 89) * 6), cj = bj * 8 + 1 + Math.floor(this.hash(bi, bj, 90) * 6);
      if (this.baseZone(ci, cj) === "hall" && !this.inManila(ci, cj) && Math.hypot(ci, cj) > 5) c = [ci, cj];
    }
    this.coreCache.set(k, c); return c;
  }
  isRedCore(i: number, j: number) { const c = this.blockCore(Math.floor(i / 8), Math.floor(j / 8)); return !!c && c[0] === i && c[1] === j; }
  redEntrance(ci: number, cj: number) { return edgeKey(ci, cj, Math.floor(this.hash(ci, cj, 91) * 4)); }   // exactly one way in
  redCoresNear(i: number, j: number): [number, number][] {
    const out: [number, number][] = [], bi = Math.floor(i / 8), bj = Math.floor(j / 8);
    for (let a = bi - 1; a <= bi + 1; a++) for (let b = bj - 1; b <= bj + 1; b++) { const c = this.blockCore(a, b); if (c) out.push(c); }
    return out;
  }
  redDist(i: number, j: number) { let best = 99; for (const [a, b] of this.redCoresNear(i, j)) best = Math.min(best, Math.hypot(a - i, b - j)); return best; }
  zone(i: number, j: number): Zone { return this.inManila(i, j) ? "manila" : this.isRedCore(i, j) ? "red" : this.baseZone(i, j); }
  stable(i: number, j: number) { const z = this.zone(i, j); return z === "arch" || z === "manila" || z === "red"; }
  manilaDist(i: number, j: number) { return Math.hypot(i - (this.manila[0] + .5), j - (this.manila[1] + .5)); }
  yellower(k: string) { const [[a, b]] = edgeCells(k); return this.hash(a, b, k[0] === "v" ? 5 : 6, 311) < .06; }   // Level 311 walls

  /* ---------- generation ---------- */
  edgeAt(i: number, j: number, d: Dir | number) { return this.edges.get(edgeKey(i, j, d)); }
  rollEdge(k: string): Edge {
    const [[a, b], [c, d]] = edgeCells(k), za = this.zone(a, b), zb = this.zone(c, d);
    const ver = (this.cells.get(ck(a, b))?.ver || 0) * 31 + (this.cells.get(ck(c, d))?.ver || 0);
    const r = this.hash(...k.slice(2).split(",").map(Number), k[0] === "v" ? 1 : 2, ver);
    if (za === "manila" || zb === "manila") return za === zb ? "open" : this.manilaDoors().has(k) ? "door-manila" : "mwall";
    if (za === "red" || zb === "red") { const [ci, cj] = za === "red" ? [a, b] : [c, d]; return k === this.redEntrance(ci, cj) ? "open" : "wall"; }
    if (za === "pillar" && zb === "pillar") return "open";
    if (za === "arch" || zb === "arch") return r < .62 ? "arch" : "wall";
    if (za === "pillar" || zb === "pillar" || za === "pit" || zb === "pit") return r < .7 ? "open" : "wall";
    return r < .56 ? "open" : r < .6 ? "door-wood" : r < .615 ? "door-metal" : "wall";
  }
  rollCell(i: number, j: number) {
    const old = this.cells.get(ck(i, j)), ver = old?.ver || 0, z = this.zone(i, j), h = (...n: number[]) => this.hash(i, j, ver, ...n);
    const c: Cell = { i, j, ver, panel: null, hole: false, pits: [], items: [], searched: false, salt: false };
    if (z === "manila") { c.panel = { int: .78, warm: 0 }; this.cells.set(ck(i, j), c); return; }
    if (z === "red") { c.panel = { int: 1.35, warm: 0, red: true }; this.cells.set(ck(i, j), c); return; }
    const r = h(9);
    if (z !== "dark" && r < .84) c.panel = r < .76 ? { int: .85 + h(11) * .3, warm: h(12) } : "dead";
    if (z === "dark" && r < .4) c.panel = "dead";
    if (c.panel && c.panel !== "dead" && (z === "hall" || z === "pillar") && h(15) < .05) c.panel.flick = true;
    const start = i === 0 && j === 0;
    if (z === "hall" && !start && h(13) < .1) c.hole = true;
    if (z === "pit") for (const px of [-1, 1]) for (const pz of [-1, 1]) if (this.hash(i, j, px, pz, 14) < .85) c.pits.push([px, pz]);
    if ((z === "hall" || z === "pillar") && h(16) < .05) c.salt = true;
    if (!start && z !== "pit" && h(21) < .035) {               // a flask somebody dropped
      const key = ck(i, j) + ":" + ver;
      if (!this.picked.has(key)) c.items.push({ key, id: "bottle", bottle: this.rollBottle(i, j, ver), x: (this.hash(i, j, 24) - .5) * 2, z: (this.hash(i, j, 25) - .5) * 2 });
    }
    this.cells.set(ck(i, j), c);
  }
  rollBottle(i: number, j: number, ver: number, salt = 0): Bottle {
    const h = (n: number) => this.hash(i, j, ver, salt, n);
    const r = h(31), color: BottleColor = r < .42 ? "grey" : r < .58 ? "green" : r < .72 ? "blue" : "reddish";
    const liquid = color === "grey" ? "aw_grey" : color === "green" ? "aw_green" : color === "blue" ? "aw_blue" : h(32) < .5 ? "aw_red" : "liquid_pain";
    const full = h(33) < .68, sealed = full && h(34) < .8;
    return { liquid, color, full, sealed, spoiled: !full && h(35) < .6 };
  }
  fixDeadEnd(i: number, j: number, protect?: (k: string) => boolean) {
    if (this.zone(i, j) === "red") return;
    const ks = [0, 1, 2, 3].map(d => edgeKey(i, j, d));
    let open = ks.filter(k => traversable(this.edges.get(k))).length, n = 0;
    while (open < 2 && n++ < 6) {
      const k = ks[Math.floor(this.hash(i, j, n, 31) * 4)];
      if ((protect && protect(k)) || this.fixed.has(k) || edgeCells(k).some(([a, b]) => { const z = this.zone(a, b); return z === "manila" || z === "red"; })) continue;
      const t = this.edges.get(k);
      if (!traversable(t) && t !== "flicker" && t !== "fakeflicker") { this.edges.set(k, this.zone(i, j) === "arch" ? "arch" : "open"); open++; }
    }
  }
  /** Make sure everything within `r` cells exists; forget what is far away. */
  ensureAround(ci: number, cj: number, r = VIEW) {
    const G = r + 2;
    for (let i = ci - G; i <= ci + G; i++) for (let j = cj - G; j <= cj + G; j++) if (!this.cells.has(ck(i, j))) this.rollCell(i, j);
    for (let i = ci - G; i <= ci + G; i++) for (let j = cj - G; j <= cj + G; j++) for (const d of [1, 2]) { const k = edgeKey(i, j, d); if (!this.edges.has(k)) this.edges.set(k, this.rollEdge(k)); }
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) this.fixDeadEnd(i, j);
    for (const [k, c] of this.cells) if (Math.abs(c.i - ci) > G + 2 || Math.abs(c.j - cj) > G + 2) this.cells.delete(k);
    for (const k of [...this.edges.keys()]) {
      const [[a, b]] = edgeCells(k);
      if ((Math.abs(a - ci) > G + 2 || Math.abs(b - cj) > G + 2) && k !== this.flickerKey) { this.edges.delete(k); this.opened.delete(k); }
    }
  }

  /* ---------- peripheral shift ---------- */
  /** Cells the player could be looking at from these poses: the 3×3 around them plus a wide cone ahead. */
  visibleFrom(poses: { i: number; j: number; d: Dir }[]): Set<string> {
    const vis = new Set<string>();
    for (const p of poses) {
      const [fx, fz] = DV[p.d];
      for (let di = -VIEW; di <= VIEW; di++) for (let dj = -VIEW; dj <= VIEW; dj++) {
        if (Math.abs(di) <= 1 && Math.abs(dj) <= 1) { vis.add(ck(p.i + di, p.j + dj)); continue; }
        const dist = Math.hypot(di, dj); if (dist > VIEW + .5) continue;
        // a cell is in view if any part of it falls inside a ±62° cone (wide enough for any screen shape and free look reset)
        const ax = di + fx * 1.35 / S, az = dj + fz * 1.35 / S, cos = (ax * fx + az * fz) / Math.hypot(ax, az);
        if (cos > Math.cos(1.08) - .7 / dist) vis.add(ck(p.i + di, p.j + dj));
      }
    }
    return vis;
  }
  /** Regenerate every cell nobody is looking at. Returns how many changed. */
  shiftUnseen(vis: Set<string>, sleeping = false): number {
    const changed: Cell[] = [];
    for (const [k, c] of this.cells) if (!vis.has(k) && !this.stable(c.i, c.j)) { c.ver++; changed.push(c); }
    if (!changed.length) return 0;
    const protect = (ek: string) => edgeCells(ek).some(([a, b]) => vis.has(ck(a, b)) || this.stable(a, b)) || ek === this.flickerKey || this.fixed.has(ek);
    for (const c of changed) { const v = c.ver; this.rollCell(c.i, c.j); this.cells.get(ck(c.i, c.j))!.ver = v; }
    for (const c of changed) for (let d = 0; d < 4; d++) {
      const ek = edgeKey(c.i, c.j, d);
      if (this.edges.has(ek) && !protect(ek)) { this.edges.set(ek, this.rollEdge(ek)); this.opened.delete(ek); }
    }
    for (const c of changed) this.fixDeadEnd(c.i, c.j, protect);
    if (this.fakeKey && !sleeping) { const [[a, b]] = edgeCells(this.fakeKey); if (!vis.has(ck(a, b))) { if (this.edges.get(this.fakeKey) === "fakeflicker") this.edges.set(this.fakeKey, "wall"); this.fakeKey = null; } }
    return changed.length;
  }

  /** Walk straight ahead and return the first wall at least one cell away, if the corridor is open until then. */
  wallAhead(i: number, j: number, d: Dir, maxSteps = 4): string | null {
    for (let s = 0; s < maxSteps; s++) {
      const k = edgeKey(i, j, d), t = this.edges.get(k);
      if (t === "wall" && s >= 1 && !edgeCells(k).some(([a, b]) => this.stable(a, b)) && !this.fixed.has(k)) return k;
      if (!passable(t)) return null;
      i += DV[d][0]; j += DV[d][1];
    }
    return null;
  }
  straightRun(i: number, j: number, d: Dir, max = 4): number { let s = 0; while (s < max && passable(this.edgeAt(i, j, d))) { i += DV[d][0]; j += DV[d][1]; s++; } return s; }
}
