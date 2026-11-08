/* Vite plugin: loads every YAML file under content/, validates it with Zod and exposes it as `virtual:content`. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import type { Plugin } from "vite";
import { Content, checkRefs, type ContentData } from "./content-schema";

const ROOT = join(__dirname, "..", "content");
const ID = "virtual:content", RID = "\0" + ID;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".yaml") ? [p] : []; });
}
export function loadContent(): ContentData {
  const out: Record<string, unknown[]> = { items: [], liquids: [], events: [], endings: [], clues: [], sources: [], puzzles: [], quests: [], dialogue: [] };
  for (const f of files(ROOT)) {
    const kind = relative(ROOT, f).split(/[\\/]/)[0];
    const data = parse(readFileSync(f, "utf8"));
    if (!(kind in out)) throw new Error(`content: unknown folder for ${f}`);
    if (!Array.isArray(data)) throw new Error(`content: ${f} must be a list`);
    out[kind].push(...data);
  }
  const r = Content.safeParse(out);
  if (!r.success) throw new Error("content validation failed:\n" + r.error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
  const errs = checkRefs(r.data), hard = errs.filter(e => !e.startsWith("warning"));
  for (const w of errs.filter(e => e.startsWith("warning"))) console.warn("content", w);
  if (hard.length) throw new Error("content errors:\n  " + hard.join("\n  "));
  return r.data;
}
export function contentPlugin(): Plugin {
  return {
    name: "backrooms-content",
    resolveId: id => (id === ID ? RID : null),
    load(id) {
      if (id !== RID) return null;
      for (const f of files(ROOT)) this.addWatchFile(f);
      return "export default " + JSON.stringify(loadContent());
    }
  };
}
