/* Symbol locks own their random stream. Positions and contents outlive cached map cells. */
import type { PuzzleData } from "../../tools/content-schema";
import type { LockedPack, LockSymbol, Meta, RunState } from "../state/types";

export const SYMBOLS: Record<LockSymbol, string> = { circle: "○", triangle: "△", square: "□" };
function shuffle<T>(values: readonly T[], rand: () => number): T[] {
  const a = [...values];
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
}
export function packCode(pack: LockedPack): number[] { return pack.order.map(s => pack.numbers[s]); }
export function validCode(code: readonly number[]): boolean { return code.length === 3 && code.every(n => Number.isInteger(n) && n >= 0 && n <= 9); }
export function matchesPack(pack: LockedPack, code: readonly number[]): boolean { return validCode(code) && packCode(pack).every((n, k) => n === code[k]); }

export function makePack(p: PuzzleData, r: RunState, m: Meta, pos: { i: number; j: number }, rand: () => number): LockedPack {
  const previous = m.symbolLock.lastCode;
  const n = previous !== null && /^\d{3}$/.test(previous) ? (() => { const x = Math.floor(rand() * 999); return x >= Number(previous) ? x + 1 : x; })() : Math.floor(rand() * 1000);
  const digits = String(n).padStart(3, "0").split("").map(Number), order = shuffle(p.symbols, rand);
  const numbers = { circle: 0, triangle: 0, square: 0 }; order.forEach((s, k) => { numbers[s] = digits[k]; });
  const pack: LockedPack = {
    id: p.id, pos: { ...pos }, order, numbers, marksOrder: shuffle(p.symbols, rand),
    seen: false, hasRuleNote: false, marksSeen: false, failures: 0, jammed: false, openedBy: null, items: []
  };
  for (const x of p.contents) if (x.chance === 1 || rand() < x.chance) for (let k = 0; k < x.count; k++) pack.items.push({ key: `pack:${r.run}:${pack.items.length}`, id: x.item });
  m.symbolLock.lastCode = digits.join("");
  return pack;
}
