/* Stable warehouse geometry. Supply and cell changes survive cache eviction; generation never draws RNG. */
import type { LevelData } from "../../tools/content-schema";
import { ck, DV, type Dir } from "../core/types";
import { hashWith } from "../core/rng";
import type { InvItem } from "../state/types";
import { edgeKey, edgeCells, VIEW, type Bottle, type Cell, type Edge, type Level1Zone, type Listener, type Pose, type World } from "./types";

export interface SupplyCrate {
  id: string; i: number; j: number; kind: "emergency" | "supply" | "tools" | "base";
  examined: boolean; opened: boolean; items: InvItem[];
}
export interface Level1WorldData {
  seed: number; cells: Cell[]; edges: [string, Edge][]; opened: [string, number][];
  picked: string[]; corpse: [number, number] | null; crates: SupplyCrate[]; generated: string[];
}
export class Level1 implements World<Level1Zone, Level1WorldData> {
  readonly level = "level-1" as const;
  readonly cells = new Map<string, Cell>();
  readonly edges = new Map<string, Edge>();
  readonly picked = new Set<string>();
  readonly opened = new Map<string, number>();
  readonly crates = new Map<string, SupplyCrate>();
  readonly generated = new Set<string>();
  readonly listeners: Listener[] = [];
  readonly base: [number, number];
  readonly rotation: Dir;
  readonly distance: number;
  corpse: [number, number] | null = null;
  private changes = new Map<string, Cell>();

  constructor(readonly seed: number, readonly rules: LevelData, data?: Level1WorldData) {
    this.rotation = Math.floor(this.hash(1) * 4) as Dir;
    this.distance = rules.layout.baseMin + Math.floor(this.hash(2) * (rules.layout.baseMax - rules.layout.baseMin + 1));
    this.base = this.global(this.distance, 0);
    if (data) {
      data.cells.forEach(c => this.changes.set(ck(c.i, c.j), c));
      data.opened.forEach(([k, a]) => this.opened.set(k, a)); data.picked.forEach(k => this.picked.add(k));
      data.crates.forEach(c => this.crates.set(c.id, c)); data.generated.forEach(k => this.generated.add(k));
      this.corpse = data.corpse;
    } else {
      const [bi, bj] = this.base.map(n => Math.floor(n / 8));
      for (let a = -rules.supplies.radius; a <= rules.supplies.radius; a++) for (let b = -rules.supplies.radius; b <= rules.supplies.radius; b++) if (Math.abs(a) + Math.abs(b) <= rules.supplies.radius) this.populate(bi + a, bj + b);
      this.crates.set("arrival", { id: "arrival", i: 0, j: 0, kind: "emergency", examined: true, opened: true,
      items: rules.supplies.emergency.flatMap(x => Array.from({ length: x.count }, (_, n) => ({ key: `l1:arrival:${x.item}:${n}`, id: x.item }))) });
    }
  }
  hash(...n: number[]) { return hashWith(this.seed, 1901, ...n); }
  global(u: number, v: number): [number, number] {
    const [x, z] = DV[this.rotation], [rx, rz] = DV[(this.rotation + 1) % 4];
    return [u * x + v * rx, u * z + v * rz];
  }
  local(i: number, j: number): [number, number] {
    const [x, z] = DV[this.rotation], [rx, rz] = DV[(this.rotation + 1) % 4];
    return [i * x + j * z, i * rx + j * rz];
  }
  zone(i: number, j: number): Level1Zone {
    const [u, v] = this.local(i, j);
    if (u >= this.distance && u <= this.distance + 1 && v >= 0 && v <= 1) return "alpha";
    if (i === 0 && j === 0) return "arrival";
    return v !== 0 && this.hash(Math.floor(u / 8), Math.floor(v / 8), 3) < .5 ? "storage" : "warehouse";
  }
  rollBottle(i: number, j: number, ver: number): Bottle {
    const h = this.hash(i, j, ver, 90), color = h < .5 ? "grey" : h < .7 ? "green" : h < .85 ? "blue" : "reddish";
    return { liquid: color === "grey" ? "aw_grey" : color === "green" ? "aw_green" : color === "blue" ? "aw_blue" : this.hash(i, j, ver, 91) < .5 ? "aw_red" : "liquid_pain",
      color, full: true, sealed: true, spoiled: false };
  }
  stable(_i: number, _j: number) { return true; }
  wet(i: number, j: number) { return this.zone(i, j) !== "alpha" && (this.hash(i, j, 4) < .24 || (i === 0 && j === 0)); }
  routeMark(i: number, j: number): Dir | null {
    const [u, v] = this.local(i, j);
    return v === 0 && u >= 0 && u < this.distance ? this.rotation : null;
  }
  private edgeType(i: number, j: number, d: number): Edge {
    const ni = i + DV[d][0], nj = j + DV[d][1], za = this.zone(i, j), zb = this.zone(ni, nj);
    const [u, v] = this.local(i, j), [a, b] = this.local(ni, nj);
    if (za === "alpha" || zb === "alpha") {
      if (za === zb) return "open";
      return v === 0 && b === 0 && Math.min(u, a) === this.distance - 1 ? "open" : "wall";
    }
    // Partial dividers have regular gaps; the marked v=0 route always remains open.
    const mod = (n: number, k: number) => ((n % k) + k) % k;
    if (u !== a && mod(Math.min(u, a), 6) === 3 && mod(v, 6) > 1) return "wall";
    if (v !== b && mod(Math.min(v, b), 8) === 4 && mod(u, 8) > 1) return "wall";
    return "open";
  }
  edgeAt(i: number, j: number, d: number) { return this.edges.get(edgeKey(i, j, d)) ?? this.edgeType(i, j, d); }
  private cell(i: number, j: number): Cell {
    return { i, j, ver: 0, panel: this.zone(i, j) === "alpha" || this.hash(i, j, 5) < .75 ? { int: 1, warm: 1 } : "dead",
      hole: false, pits: [], items: [], searched: false, salt: false };
  }
  inSupplyArea(i: number, j: number) {
    return Math.abs(Math.floor(i / 8) - Math.floor(this.base[0] / 8)) + Math.abs(Math.floor(j / 8) - Math.floor(this.base[1] / 8)) <= this.rules.supplies.radius;
  }
  private populate(bi: number, bj: number) {
    if (!this.inSupplyArea(bi * 8, bj * 8)) return;
    const k = ck(bi, bj); if (this.generated.has(k)) return; this.generated.add(k);
    for (let n = 0; n < this.rules.supplies.perChunk; n++) {
      const i = bi * 8 + 1 + Math.floor(this.hash(bi, bj, n, 10) * 6), j = bj * 8 + 1 + Math.floor(this.hash(bi, bj, n, 11) * 6);
      if (this.zone(i, j) === "alpha") continue;
      const id = `crate:${bi},${bj}:${n}`, items: InvItem[] = [];
      const add = (item: string) => items.push({ key: `${id}:${items.length}`, id: item });
      if (this.hash(bi, bj, n, 12) < this.rules.supplies.waterChance) add("almond_water");
      if (this.hash(bi, bj, n, 13) < this.rules.supplies.foodChance) add("snack_bar");
      const tool = this.hash(bi, bj, n, 14) < this.rules.supplies.toolChance;
      if (tool) add(this.hash(bi, bj, n, 15) < .5 ? "crowbar" : "bandage");
      this.crates.set(id, { id, i, j, kind: tool ? "tools" : "supply", examined: false, opened: false, items });
    }
  }
  ensureAround(ci: number, cj: number, r = VIEW) {
    for (let i = ci - r - 2; i <= ci + r + 2; i++) for (let j = cj - r - 2; j <= cj + r + 2; j++) {
      const k = ck(i, j); if (!this.cells.has(k)) this.cells.set(k, this.changes.get(k) ?? this.cell(i, j));
      for (const d of [1, 2]) this.edges.set(edgeKey(i, j, d), this.edgeType(i, j, d));
      this.populate(Math.floor(i / 8), Math.floor(j / 8));
    }
    for (const [k, c] of this.cells) if (Math.abs(c.i - ci) > r + 4 || Math.abs(c.j - cj) > r + 4) {
      if (c.searched || c.items.length) this.changes.set(k, c); this.cells.delete(k);
    }
    for (const k of this.edges.keys()) {
      const [[i, j]] = edgeCells(k); if (Math.abs(i - ci) > r + 4 || Math.abs(j - cj) > r + 4) this.edges.delete(k);
    }
  }
  visibleFrom(poses: Pose[]): Set<string> {
    const out = new Set<string>();
    for (const p of poses) for (let i = p.i - VIEW; i <= p.i + VIEW; i++) for (let j = p.j - VIEW; j <= p.j + VIEW; j++) {
      const [dx, dz] = DV[p.d], a = i - p.i, b = j - p.j;
      if ((Math.abs(a) <= 1 && Math.abs(b) <= 1) || (Math.hypot(a, b) <= VIEW && a * dx + b * dz > 0)) out.add(ck(i, j));
    }
    return out;
  }
  toData(): Level1WorldData {
    const changes = new Map(this.changes);
    for (const [k, c] of this.cells) if (c.searched || c.items.length) changes.set(k, c);
    return { seed: this.seed, cells: [...changes.values()], edges: [], picked: [...this.picked], opened: [...this.opened],
      corpse: this.corpse, crates: [...this.crates.values()], generated: [...this.generated] };
  }
}
