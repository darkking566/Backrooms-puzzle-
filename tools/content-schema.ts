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
  id: z.string(), kind: z.enum(["death", "exit", "ending"]), title: Text, text: Text, points: z.number().default(0),
  legacy: z.boolean().default(false), textByLevel: z.object({ "level-1": Text }).strict().optional()
}).strict();

export const Clue = z.object({ id: z.string(), title: Text, text: Text, source: z.string().optional() }).strict();

export const Source = z.object({ id: z.string(), title: z.string(), authors: z.string(), url: z.string().url(), used: Text }).strict();

const Chance = z.number().min(0).max(1);
const Supplies = z.array(z.object({ item: z.string(), count: z.number().int().positive() }).strict());
export const Level = z.object({
  id: z.literal("level-1"), name: Text, arrival: Text, again: Text, guide: Text, sign: Text,
  zones: z.object({ arrival: Text, warehouse: Text, storage: Text, alpha: Text }).strict(),
  layout: z.object({ chunkSize: z.literal(8), baseMin: z.number().int().min(8), baseMax: z.number().int().max(12) }).strict(),
  supplies: z.object({ emergency: Supplies, base: Supplies, waterChance: Chance, foodChance: Chance, toolChance: Chance }).strict(),
  crate: z.object({ name: Text, description: Text, latch: Text, opened: Text, empty: Text, needLatch: Text,
    examineMinutes: z.number().int().positive(), openMinutes: z.number().int().positive(), crowbarMinutes: z.number().int().positive() }).strict(),
  base: z.object({ name: Text, supplies: Text, claimed: Text, rest: Text, outsideRest: Text }).strict(),
  survival: z.object({ sanity: z.number(), darkSanity: z.number(), baseSanity: z.number().positive() }).strict(),
  source: z.string()
}).strict().refine(x => x.layout.baseMin <= x.layout.baseMax, "baseMin must not exceed baseMax");
export type LevelData = z.infer<typeof Level>;
export const Reward = z.object({ id: z.literal("level1"), arrival: z.number().int().nonnegative(),
  firstArrival: z.number().int().nonnegative(), survivalMultiplier: z.number().min(0).max(1), survivalCap: z.number().int().nonnegative() }).strict();
const MinutesRange = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(x => x[0] <= x[1], "inverted minute range");
export const Hazard = z.object({
  id: z.literal("smiler"), level: z.literal("level-1"), source: z.string(),
  power: z.object({ first: MinutesRange, interval: MinutesRange, warning: z.number().int().positive(), duration: MinutesRange }).strict(),
  encounter: z.object({ chance: Chance, lightChance: Chance, damage: z.number().positive(), bleedingHours: z.number().positive(), vanishChance: Chance }).strict(),
  text: z.object({ warning: Text, warningCaption: Text, blackout: Text, relight: Text, noticedLit: Text, noticedDark: Text,
    litCaption: Text, darkCaption: Text, approaching: Text, retreat: Text, hurt: Text, vanished: Text, wait: Text }).strict()
}).strict();
export type HazardData = z.infer<typeof Hazard>;
export const Puzzle = z.object({
  id: z.string(), kind: z.literal("symbol_lock"),
  spawn: z.object({ minRun: z.number().int().min(1), chance: Chance, minMoves: z.number().int().min(0), zone: z.literal("arch") }).strict(),
  symbols: z.tuple([z.literal("circle"), z.literal("triangle"), z.literal("square")]), digits: z.literal(3),
  jamAfter: z.number().int().min(1),
  minutes: z.object({ examineMarks: z.number().int().positive(), attempt: z.number().int().positive(), unjam: z.number().int().positive(), force: z.number().int().positive() }).strict(),
  methodClue: z.string(),
  contents: z.array(z.object({ item: z.string(), count: z.number().int().positive(), chance: Chance }).strict()),
  text: z.object({
    name: Text, description: Text, ruleNote: Text, paper: Text, inside: Text, locked: Text,
    failure: Text, failureCaption: Text, jammed: Text, freed: Text, opened: Text, openedCaption: Text,
    forced: Text, forcedCaption: Text, full: Text, empty: Text, invalid: Text, needCrowbar: Text
  }).strict()
}).strict();
export type PuzzleData = z.infer<typeof Puzzle>;

export const Quest = z.object({
  id: z.string(), kind: z.literal("manila_stranger"), npc: z.string(),
  spawn: z.object({ minRun: z.number().int().positive(), requiresDiscovery: z.literal("manila"), chance: Chance, pityAfterMisses: z.number().int().nonnegative() }).strict(),
  revisit: z.object({ chance: Chance, pityAfterMisses: z.number().int().nonnegative() }).strict(),
  pack: z.object({ puzzle: z.string(), placement: z.literal("manila"), redirectCabinetTopUp: z.literal(true), extraWater: z.number().int().positive() }).strict(),
  completionReward: z.number().int().nonnegative(), dialogue: z.string(),
  clues: z.object({ separation: z.string(), aftermath: z.string(), promise: z.string(), waited: z.string(), returned: z.string() }).strict(),
  text: z.object({ name: Text, first: Text, revisit: Text, lowSanity: Text, cabinetEmpty: Text, cabinetStocked: Text,
    greeting: Text, familiar: Text, recovered: Text, gone: Text, playerLeft: Text, personLeft: Text,
    returnedWet: Text, returnedDry: Text, leftWater: Text, aftermath: Text, reward: Text, packPaper: Text, packInside: Text,
    noWater: Text, notReady: Text }).strict()
}).strict();
export const Dialogue = z.object({ id: z.string(), choices: z.array(z.object({
  id: z.string(), action: z.enum(["ask", "give_water", "give_water_and_promise", "promise", "wait", "ask_leave"]),
  when: z.enum(["always", "needs_water", "ready_unpromised", "not_waited", "ready"]),
  requires: z.object({ water: z.literal("sealed_grey") }).strict().optional(),
  minutes: z.number().int().nonnegative(), text: Text, result: Text
}).strict()).min(1) }).strict();
export type QuestData = z.infer<typeof Quest>;
export type DialogueChoice = z.infer<typeof Dialogue>["choices"][number];

export const Content = z.object({
  items: z.array(Item), liquids: z.array(Liquid), events: z.array(Event), endings: z.array(Ending),
  clues: z.array(Clue), sources: z.array(Source), puzzles: z.array(Puzzle), quests: z.array(Quest), dialogue: z.array(Dialogue),
  levels: z.array(Level), rewards: z.array(Reward), hazards: z.array(Hazard)
});
export type ContentData = z.infer<typeof Content>;

/* cross references */
export function checkRefs(c: ContentData): string[] {
  const errs: string[] = [];
  const ids = (a: { id: string }[], what: string) => { const s = new Set<string>(); for (const x of a) { if (s.has(x.id)) errs.push(`duplicate ${what} id: ${x.id}`); s.add(x.id); } return s; };
  const items = ids(c.items, "item"), sources = ids(c.sources, "source"), endings = ids(c.endings, "ending");
  ids(c.liquids, "liquid"); ids(c.events, "event"); const clues = ids(c.clues, "clue"), puzzles = ids(c.puzzles, "puzzle"), dialogue = ids(c.dialogue, "dialogue"); ids(c.quests, "quest");
  for (const q of c.quests) {
    if (!puzzles.has(q.pack.puzzle)) errs.push(`${q.id}: unknown puzzle ${q.pack.puzzle}`);
    if (!dialogue.has(q.dialogue)) errs.push(`${q.id}: unknown dialogue ${q.dialogue}`);
    for (const id of Object.values(q.clues)) if (!clues.has(id)) errs.push(`${q.id}: unknown clue ${id}`);
  }
  for (const d of c.dialogue) {
    ids(d.choices, `${d.id} choice`);
    for (const ch of d.choices) if (ch.action.startsWith("give_water") && !ch.requires?.water) errs.push(`${d.id}.${ch.id}: giving water requires sealed_grey`);
  }
  for (const p of c.puzzles) {
    if (!clues.has(p.methodClue)) errs.push(`${p.id}: unknown clue ${p.methodClue}`);
    for (const x of p.contents) if (!items.has(x.item)) errs.push(`${p.id}: unknown item ${x.item}`);
  }
  const src = (s: string | undefined, where: string) => { if (s && !sources.has(s)) errs.push(`${where}: unknown source ${s}`); };
  ids(c.levels, "level"); ids(c.rewards, "reward");
  ids(c.hazards, "hazard"); for (const h of c.hazards) src(h.source, h.id);
  for (const l of c.levels) {
    src(l.source, l.id);
    for (const x of [...l.supplies.emergency, ...l.supplies.base]) if (!items.has(x.item)) errs.push(`${l.id}: unknown item ${x.item}`);
  }
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
