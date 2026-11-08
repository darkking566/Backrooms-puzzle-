/* Auto-play bot for balancing (DESIGN §18.9). Off by default: BOT=1 npx vitest run tests/bot.test.ts */
import { playLegacyLevel0 } from "./legacy-bot";
import { distribution } from "./bot-stats";
import { writeFileSync } from "node:fs";
import { playWarehouse } from "./warehouse-bot";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadContent } from "../tools/content-plugin";
import { Game } from "../src/core/game";
import { newMeta } from "../src/state/types";
import { passable } from "../src/world/level0";
import { DV, type Dir } from "../src/core/types";

const c = loadContent();
describe.skipIf(!process.env.BOT)("bot", () => {
  it("plays many runs", () => {
    const ends: Record<string, number> = {}, hours: number[] = [];
    const finalEnds: Record<string, number> = {}, warehouseHours: number[] = []; let reachedBase = 0, entered = 0;
    const finalPoints: number[] = [], died: number[] = [], censored: number[] = []; const warehouseSamples: unknown[] = []; let metElder = 0, returned = 0, noticed = 0, avoided = 0;
    const baseline = JSON.parse(readFileSync(new URL("./fixtures/level0-bot.json", import.meta.url), "utf8")) as { seed: number; ending: string; minutes: number; points: number; digest: string }[];
    const samples: { seed: number; ending: string; minutes: number; points: number; digest: string }[] = [];
    for (let s = 0; s < 300; s++) {
      const g = Game.newRun(c, newMeta(), 1000 + s, []); let x = s * 7919 + 1;
      const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let step = 0; step < 4000 && !g.run.ended; step++) {
        const r = g.run;
        if (r.pendingEvent) { g.dispatch({ type: "choose", index: 0 }); continue; }
        // a careful player: drink full sealed non-reddish flasks, eat, sleep when tired, search sometimes
        const drinkable = r.inv.find(i => i.id === "almond_water" || (i.bottle && i.bottle.liquid !== "empty" && i.bottle.full && i.bottle.color !== "reddish"));
        if (drinkable && r.stats.water < 45) { g.dispatch({ type: "drink", key: drinkable.key }); continue; }
        const food = r.inv.find(i => i.id === "snack_bar"); if (food && r.stats.food < 40) { g.dispatch({ type: "eat", key: food.key }); continue; }
        if (r.stats.awake > 18 * 60) { g.dispatch({ type: "rest", hours: 8 }); continue; }
        const cell = g.cellHere();
        if (cell.items.length) { g.dispatch({ type: "pickup", key: cell.items[0].key }); continue; }
        if (cell.hole && !cell.searched) { g.dispatch({ type: "ceiling" }); continue; }
        if (!cell.searched && rnd() < .15) { g.dispatch({ type: "search" }); continue; }
        if (g.level0.flickerKey) { g.dispatch({ type: "flicker", edge: g.level0.flickerKey }); if (g.run.ended || g.run.level === "level-1") break; }
        const { i, j, d } = r.pos; const opts = ([d, (d + 1) % 4, (d + 3) % 4] as Dir[]).filter(k => passable(g.world.edgeAt(i, j, k)) && g.level0.redDist(i + DV[k][0], j + DV[k][1]) > 1.5);
        if (!opts.length) { g.dispatch({ type: "turn", dir: 2 }); continue; }
        g.dispatch({ type: "move", d: opts[rnd() < .6 ? 0 : Math.floor(rnd() * opts.length)] });
      }
      const e = g.run.level === "level-1" ? "exit_level1" : g.run.ended?.ending ?? "alive"; ends[e] = (ends[e] ?? 0) + 1; hours.push(g.run.time / 60);
      const state = JSON.parse(JSON.stringify(g.save()));
      for (const key of ["level", "mapPages", "l1", "flashlightOn", "npcSeenThisRun", "pendingRewards"]) delete state[key];
      const { corpses, ...meta } = g.meta;
      const legacyMeta = { ...meta, corpse: corpses["level-0"] ?? null };
      // Preserve legacy key order as well as values for the pre-refactor digest.
      const orderedMeta = Object.fromEntries(["v", "name", "runs", "points", "discoveries", "endings", "clues", "notes", "cabinet", "corpse", "history", "symbolLock", "roomPerson", "npcMeetings", "settings"].map(k => [k, legacyMeta[k as keyof typeof legacyMeta]]));
      samples.push({ seed: 1000 + s, ending: e, minutes: g.run.time, points: g.run.ended?.points ?? 0,
        digest: createHash("sha256").update(JSON.stringify({ run: state, meta: orderedMeta })).digest("hex") });
      const sample = samples.at(-1)!, reference = baseline[s];
      expect({ seed: sample.seed, ending: sample.ending, minutes: sample.minutes }).toEqual({ seed: reference.seed, ending: reference.ending, minutes: reference.minutes });
      if (g.run.level === "level-0") expect(sample).toEqual(reference);
      else {
        entered++; const result = playWarehouse(g); if (result.reachedBase) reachedBase++; warehouseHours.push(result.hours); metElder += +result.metElder;
        (g.run.ended ? died : censored).push(result.hours); const l = g.run.l1!;
        returned += +(l.baseVisits > 1); noticed += l.hazards.noticed; avoided += l.hazards.avoided;
        warehouseSamples.push({ seed: 1000+s, hours: result.hours, ending: g.run.ended?.ending ?? "censored", baseVisits: l.baseVisits, searches: l.searches, hazards: l.hazards, points: g.run.ended?.points, breakdown: g.run.ended?.breakdown });
      }
      const final = `${g.run.level}:${g.run.ended?.ending ?? "alive"}`; finalEnds[final] = (finalEnds[final] ?? 0) + 1;
      if (g.run.ended) finalPoints.push(g.run.ended.points);
    }
    const points = baseline.filter(s => s.ending !== "alive").map(s => s.points).sort((a, b) => a - b);
    console.log("memory points", JSON.stringify({ completed: points.length, censored: baseline.length - points.length,
      mean: points.reduce((a, b) => a + b, 0) / points.length, p10: points[Math.floor(points.length * .1)],
      median: points[Math.floor(points.length * .5)], p90: points[Math.floor(points.length * .9)], max: points.at(-1),
      bankedMeanPerStart: baseline.reduce((a, b) => a + b.points, 0) / samples.length }));
    const mean = finalPoints.reduce((a,b)=>a+b,0)/finalPoints.length, oldMean = points.reduce((a,b)=>a+b,0)/points.length;
    const report = { entered, reachedBase, metElder, returned, noticed, avoided, endings: finalEnds, deathHours: distribution(died), censoredHours: distribution(censored), points: distribution(finalPoints), censoredRuns: 300-finalPoints.length, bankedMeanPerStart: finalPoints.reduce((a,b)=>a+b,0)/300, meanRatio: mean/oldMean };
    console.log("warehouse", JSON.stringify(report));
    if (process.env.BOT_REPORT) writeFileSync(process.env.BOT_REPORT, JSON.stringify({ report, warehouseSamples }, null, 2));
    expect(censored).toHaveLength(0); expect(reachedBase).toBeGreaterThanOrEqual(150); expect(metElder).toBe(reachedBase);
    expect(report.meanRatio).toBeGreaterThanOrEqual(.75); expect(report.meanRatio).toBeLessThanOrEqual(1.25);
    hours.sort((a, b) => a - b);
    console.log("endings", JSON.stringify(ends), "hours median", hours[150].toFixed(0), "p10", hours[30].toFixed(0), "p90", hours[270].toFixed(0));
  }, 600000);
  it("keeps the shared-Meta economy near the frozen legacy campaigns", () => {
    const legacy = JSON.parse(readFileSync(new URL("./fixtures/economy-legacy.json", import.meta.url), "utf8")) as { samples: { points: number | null }[] };
    const samples: { campaign: number; seed: number; ending: string; level: string; hours: number; points: number | null; breakdown: unknown }[] = [];
    for (let campaign=0; campaign<16; campaign++) {
      const meta=newMeta();
      for(let n=0; n<10; n++) {
        const seed=100000+campaign*1000+n, g=Game.newRun(c, meta, seed, []);
        playLegacyLevel0(g, seed*7919+1);
        if (g.run.level === "level-1") playWarehouse(g);
        samples.push({ campaign, seed, ending: g.run.ended?.ending ?? "censored", level: g.run.level, hours: g.run.time/60, points: g.run.ended?.points ?? null, breakdown: g.run.ended?.breakdown });
        if (!g.run.ended) break;
      }
    }
    const oldPoints=legacy.samples.flatMap(s=>s.points === null ? [] : [s.points]), points=samples.flatMap(s=>s.points === null ? [] : [s.points]);
    const before=distribution(oldPoints), after=distribution(points), ratio=after.mean!/before.mean!;
    const report={ before, after, ratio, starts: samples.length, censored: samples.filter(s=>s.points===null).map(s=>({seed:s.seed,level:s.level,hours:s.hours})), bankedMeanPerStart: points.reduce((s,n)=>s+n,0)/samples.length };
    console.log("shared economy",JSON.stringify(report));
    if (process.env.BOT_REPORT) writeFileSync(process.env.BOT_REPORT+".shared.json", JSON.stringify({report,samples},null,2));
    expect(samples.filter(s=>s.points === null && s.level === "level-1")).toHaveLength(0);
    expect(ratio).toBeGreaterThanOrEqual(.75); expect(ratio).toBeLessThanOrEqual(1.25);
  }, 600000);

});
