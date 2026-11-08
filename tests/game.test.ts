import { describe, expect, it } from "vitest";
import { loadContent } from "../tools/content-plugin";
import { Game } from "../src/core/game";
import { newMeta } from "../src/state/types";
import { passable } from "../src/world/level0";
import { tick } from "../src/systems/survival";

const c = loadContent();
const env = { zone: "hall" as const, dark: false, redK: 0, manilaK: 0, inLevel0: true };

describe("survival", () => {
  it("water lasts about three days at rest and kills about a day after", () => {
    const g = Game.newRun(c, newMeta(), 1, []); g.run.stats.water = 100; g.run.stats.food = 100;
    let m = 0; while (g.run.stats.water > 0 && m < 200 * 60) { tick(g.run, 60, "idle", env); g.run.stats.food = 100; g.run.stats.awake = 0; m += 60; }
    expect(m / 60).toBeGreaterThan(68); expect(m / 60).toBeLessThan(76);
    let death: string | null = null; let h = 0; while (!death && h < 60) { death = tick(g.run, 60, "idle", env); g.run.stats.food = 100; g.run.stats.awake = 0; h++; }
    expect(death === "death_dehydration" || death === "death_wretch").toBe(true); expect(h).toBeLessThan(36);
  });
});

describe("game", () => {
  it("is deterministic: same seed and commands give the same run", () => {
    const play = () => {
      const g = Game.newRun(c, newMeta(), 2024, ["flashlight"]);
      for (let s = 0; s < 60 && !g.run.ended; s++) {
        if (g.run.pendingEvent) { g.dispatch({ type: "choose", index: 0 }); continue; }
        const { i, j, d } = g.run.pos; const ds = [d, (d + 1) % 4, (d + 3) % 4, (d + 2) % 4] as (0 | 1 | 2 | 3)[];
        const go = ds.find(x => passable(g.world.edgeAt(i, j, x)) && g.world.zone(i + [0, 1, 0, -1][x], j + [-1, 0, 1, 0][x]) !== "red");
        if (go === undefined) g.dispatch({ type: "turn", dir: 2 }); else g.dispatch({ type: "move", d: go });
        if (s % 7 === 0) g.dispatch({ type: "search" });
      }
      return JSON.stringify(g.save());
    };
    expect(play()).toBe(play());
  });
  it("drinking Liquid Pain ends the run", () => {
    const meta = newMeta(), g = Game.newRun(c, meta, 3, []);
    g.run.inv.push({ key: "x", id: "bottle", bottle: { liquid: "liquid_pain", color: "reddish", full: true, sealed: true, spoiled: false } });
    const o = g.dispatch({ type: "drink", key: "x" });
    expect(o.ended).toBe(true); expect(g.run.ended?.ending).toBe("death_liquid_pain");
    expect(meta.corpse?.cause).toBe("death_liquid_pain"); expect(meta.points).toBeGreaterThan(0);
  });
  it("events wait for a choice and respect required items", () => {
    const g = Game.newRun(c, newMeta(), 4, []); g.run.pendingEvent = "noise_spike";
    expect(g.dispatch({ type: "search" }).minutes).toBe(0);
    expect(g.availableChoices("noise_spike")[1].ok).toBe(false);
    g.dispatch({ type: "choose", index: 2 });
    expect(g.run.pendingEvent).toBeNull(); expect(g.run.status.hearing_damage).toBeGreaterThan(0);
  });
  it("the Manila Room cabinet and notes persist in meta", () => {
    const meta = newMeta(), g = Game.newRun(c, meta, 5, []);
    const [mi, mj] = g.world.manila; g.run.pos = { i: mi, j: mj, d: 0 }; g.world.ensureAround(mi, mj);
    const k = meta.cabinet[0].key; g.dispatch({ type: "cabinetTake", key: k });
    expect(g.run.inv.some(x => x.key === k)).toBe(true);
    g.dispatch({ type: "cabinetPut", key: k }); g.dispatch({ type: "writeNote", text: "左轉三次" });
    expect(meta.cabinet.some(x => x.key === k)).toBe(true); expect(meta.notes[0].t).toBe("左轉三次");
    const g2 = Game.newRun(c, meta, 6, []); expect(g2.meta.notes.length).toBe(1); expect(g2.run.run).toBe(2);
  });
});
