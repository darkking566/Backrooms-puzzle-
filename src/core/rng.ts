/* Deterministic randomness. Map generation hashes (seed, coordinates, version); everything else draws from
   named streams whose counters live in the run state, so a run replays exactly from its seed and commands. */
export function hashWith(seed: number, ...n: number[]): number {
  let h = 2166136261 ^ seed;
  for (const v of n) { h = Math.imul(h ^ (v | 0), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}
export function mulberry(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export type Stream = "shift" | "events" | "loot" | "body" | "misc" | "halluc" | "puzzles";
const STREAM_ID: Record<Stream, number> = { shift: 101, events: 202, loot: 303, body: 404, misc: 505, halluc: 606, puzzles: 707 };
export interface RngState { seed: number; counters: Partial<Record<Stream, number>> }
export function draw(r: RngState, s: Stream): number {
  const c = r.counters[s] ?? 0; r.counters[s] = c + 1;
  return hashWith(r.seed, STREAM_ID[s], c);
}
export const pick = <T>(r: RngState, s: Stream, a: readonly T[]): T => a[Math.floor(draw(r, s) * a.length)];
