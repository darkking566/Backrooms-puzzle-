export type Lang = "zh" | "en";
export interface Text { zh: string; en: string }
export const T = (zh: string, en: string): Text => ({ zh, en });
export type Dir = 0 | 1 | 2 | 3;                 // N E S W
export const DV: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const ck = (i: number, j: number) => i + "," + j;
export const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
