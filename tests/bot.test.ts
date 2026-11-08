/* Auto-play bot for balancing (DESIGN §18.9). Off by default: BOT=1 npx vitest run tests/bot.test.ts */
import { describe, it } from "vitest";
import { loadContent } from "../tools/content-plugin";
import { Game } from "../src/core/game";
import { newMeta } from "../src/state/types";
import { passable } from "../src/world/level0";
import { DV, type Dir } from "../src/core/types";

const c = loadContent();
describe.skipIf(!process.env.BOT)("bot", () => {
  it("plays many runs", () => {
    const ends: Record<string, number> = {}, hours: number[] = [];
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
        if (g.world.flickerKey) { g.dispatch({ type: "flicker", edge: g.world.flickerKey }); if (g.run.ended) break; }
        const { i, j, d } = r.pos; const opts = ([d, (d + 1) % 4, (d + 3) % 4] as Dir[]).filter(k => passable(g.world.edgeAt(i, j, k)) && g.world.redDist(i + DV[k][0], j + DV[k][1]) > 1.5);
        if (!opts.length) { g.dispatch({ type: "turn", dir: 2 }); continue; }
        g.dispatch({ type: "move", d: opts[rnd() < .6 ? 0 : Math.floor(rnd() * opts.length)] });
      }
      const e = g.run.ended?.ending ?? "alive"; ends[e] = (ends[e] ?? 0) + 1; hours.push(g.run.time / 60);
    }
    hours.sort((a, b) => a - b);
    console.log("endings", JSON.stringify(ends), "hours median", hours[150].toFixed(0), "p10", hours[30].toFixed(0), "p90", hours[270].toFixed(0));
  }, 600000);
});
