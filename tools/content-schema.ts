/* Zod schemas for everything under content/. The build fails on any mistake: a missing language,
   an unknown item or source id, a bad effect key. */
import { z } from "zod";

export const Text = z.object({ zh: z.string().min(1), en: z.string().min(1) }).strict();
const Effects = z.object({
  water: z.number().optional(), food: z.number().optional(), sanity: z.number().optional(),
  rest: z.number().optional(), health: z.number().optional(), wretched: z.number().optional(),
  time: z.number().optional(), status: z.array(z.string()).optional(), clearStatus: z.array(z.string()).optional()
}).strict();

export const Item = z.object({
  id: z.string(), name: Text, desc: Text, weight: z.number().min(0),
  tags: z.array(z.enum(["drink", "food", "tool", "light", "key", "bottle", "medical", "note", "fuel"])).default([]),
  effects: Effects.optional(),
  use: Text.optional(),            // verb on the item's main button, e.g. 喝 / Drink
  prep: z.object({ cost: z.number() }).optional(),   // buyable before a run, for memory points
  source: z.string().optional()
}).strict();

export const Liquid = z.object({
  id: z.string(), name: Text,
  look: Text,                      // what you can see without opening
  inspect: Text,                   // what a closer look (more time) shows
  taste: Text,                     // what a sip tells you
  effects: Effects,                // drinking the whole bottle
  sip: Effects.optional(),         // a small sip
  deadly: z.string().optional(),   // ending id when drunk
  source: z.string().optional()
}).strict();

const Choice = z.object({ text: Text, requires: z.object({ item: z.string() }).strict().optional(), result: Text, effects: Effects.optional() }).strict();
export const Event = z.object({
  id: z.string(), text: Text, caption: Text.optional(),
  trigger: z.object({ on: z.enum(["move", "rest"]), chance: z.number(), zones: z.array(z.string()).optional(), minHours: z.number().optional() }).strict(),
  once: z.enum(["per_run", "never"]).default("never"),
  choices: z.array(Choice).min(1), source: z.string().optional()
}).strict();

export const Ending = z.object({
  id: z.string(), kind: z.enum(["death", "exit", "ending"]), title: Text, text: Text, points: z.number().default(0)
}).strict();

export const Clue = z.object({ id: z.string(), title: Text, text: Text, source: z.string().optional() }).strict();

export const Source = z.object({ id: z.string(), title: z.string(), authors: z.string(), url: z.string().url(), used: Text }).strict();

export const Content = z.object({
  items: z.array(Item), liquids: z.array(Liquid), events: z.array(Event), endings: z.array(Ending),
  clues: z.array(Clue), sources: z.array(Source)
});
export type ContentData = z.infer<typeof Content>;

/* cross references */
export function checkRefs(c: ContentData): string[] {
  const errs: string[] = [];
  const ids = (a: { id: string }[], what: string) => { const s = new Set<string>(); for (const x of a) { if (s.has(x.id)) errs.push(`duplicate ${what} id: ${x.id}`); s.add(x.id); } return s; };
  const items = ids(c.items, "item"), sources = ids(c.sources, "source"), endings = ids(c.endings, "ending");
  ids(c.liquids, "liquid"); ids(c.events, "event"); ids(c.clues, "clue");
  const src = (s: string | undefined, where: string) => { if (s && !sources.has(s)) errs.push(`${where}: unknown source ${s}`); };
  for (const x of [...c.items, ...c.liquids, ...c.events, ...c.clues]) src(x.source, x.id);
  for (const l of c.liquids) if (l.deadly && !endings.has(l.deadly)) errs.push(`${l.id}: unknown ending ${l.deadly}`);
  for (const e of c.events) for (const ch of e.choices) if (ch.requires && !items.has(ch.requires.item)) errs.push(`${e.id}: unknown item ${ch.requires.item}`);
  // player-facing text must not use pronouns for the player (DESIGN 13.3); warn on he/she/他/她 in English/Chinese
  const walk = (o: unknown, path: string) => {
    if (o && typeof o === "object") { for (const [k, v] of Object.entries(o)) walk(v, path + "." + k); }
    else if (typeof o === "string" && /(^|[^a-z])(he|she|him|her)([^a-z]|$)/i.test(o) && path.endsWith(".en")) errs.push(`warning ${path}: check pronoun use`);
  };
  walk(c, "content");
  return errs;
}
