/* Frozen original decision policy, reused for shared-Meta campaigns. */
import type { Game } from "../src/core/game";
import { passable } from "../src/world/types";
import { DV, type Dir } from "../src/core/types";
export function playLegacyLevel0(g: Game, policySeed: number) {
  let x=policySeed;
  const rnd = () => ((x=(x*1103515245+12345)&0x7fffffff)/0x7fffffff);
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
}
