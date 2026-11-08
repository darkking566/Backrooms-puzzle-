/* Scripted 100 × 3-run campaigns per policy. Arrival is simulated; this measures the supply trade,
   not players' navigation skill or puzzle-solving time. The original 300-run bot remains unchanged. */
import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { newMeta } from "../src/state/types";
import { tick } from "../src/systems/survival";
import { edgeKey } from "../src/world/level0";
import { packCode } from "../src/systems/symbol-lock";
import { loadContent } from "../tools/content-plugin";
const c = loadContent(), q = c.quests[0];
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
type Policy = "control" | "give" | "leave";
function campaign(policy: Policy, sample: number) {
  const m = newMeta(); m.runs = 2; m.discoveries.push("manila"); if (policy === "control") m.roomPerson.phase = "complete";
  const hours: number[] = []; let bottles = 0, rewards = 0;
  for (let chapter = 0; chapter < 3; chapter++) {
    m.roomPerson.misses = 2;
    const g = Game.newRun(c, m, 6000 + sample * 3 + chapter, []);
    expect(tick(g.run, (8 + sample % 17) * 60, "walk", { zone: "hall", dark: false, redK: 0, manilaK: 0, inLevel0: true })).toBeNull();
    g.devJump("manila"); g.dispatch({ type: "door", edge: edgeKey(g.run.pos.i, g.run.pos.j, 1) }); g.dispatch({ type: "move", d: 1 });
    for (const x of [...m.cabinet]) g.dispatch({ type: "cabinetTake", key: x.key });
    if (g.run.lockedPack?.story === "room_person") {
      g.dispatch({ type: "packExamine" }); g.dispatch({ type: "packMarks" }); g.dispatch({ type: "packAttempt", code: packCode(g.run.lockedPack) });
      for (const x of [...g.run.lockedPack.items]) g.dispatch({ type: "packTake", key: x.key });
      if (policy === "give") g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: g.personWater()[0].key });
    }
    g.dispatch({ type: "examine", what: "notes" });
    g.dispatch({ type: "move", d: 3 }); if (g.run.pendingEvent) g.dispatch({ type: "choose", index: 0 });
    g.dispatch({ type: "move", d: 1 }); if (g.run.pendingEvent) g.dispatch({ type: "choose", index: 0 });
    for (let step = 0; step < 200 && !g.run.ended; step++) {
      const water = g.personWater()[0];
      if (water && g.run.stats.water < 45) { bottles++; g.dispatch({ type: "drink", key: water.key }); }
      else g.dispatch({ type: "rest", hours: 2 });
    }
    expect(g.run.ended).not.toBeNull(); hours.push(g.run.time / 60);
    rewards += g.run.ended!.breakdown.filter(x => x.label.en === q.text.reward.en).reduce((sum, x) => sum + x.pts, 0);
  }
  expect(m.roomPerson.phase).toBe("complete"); expect(rewards).toBe(policy === "control" ? 0 : 20);
  return { hours, bottles };
}
describe.skipIf(!process.env.BOT)("quest supply balance", () => {
  it("compares 300 runs per policy with persistent progress across each three-run campaign", () => {
    const summary: Record<string, unknown> = {}, cohorts = { control: [] as number[], give: [] as number[], leave: [] as number[] };
    const waterTotals = { control: 0, give: 0, leave: 0 };
    for (let sample = 0; sample < 100; sample++) {
      const control = campaign("control", sample), give = campaign("give", sample), leave = campaign("leave", sample);
      expect(give.hours[0]).toBeGreaterThanOrEqual(control.hours[0] - 2.25);
      expect(give.bottles).toBeGreaterThanOrEqual(control.bottles);
      for (const [policy, result] of Object.entries({ control, give, leave }) as [Policy, typeof control][]) { cohorts[policy].push(...result.hours); waterTotals[policy] += result.bottles; }
    }
    for (const policy of ["control", "give", "leave"] as Policy[]) summary[policy] = { runs: cohorts[policy].length, medianHours: Number(median(cohorts[policy]).toFixed(1)), bottlesDrunk: waterTotals[policy] };
    console.log("quest scripted balance", JSON.stringify(summary));
  }, 600000);
});
