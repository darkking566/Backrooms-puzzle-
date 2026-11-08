/* A separate warehouse policy; the legacy Level 0 policy and its random draws stay untouched. */
import type { Game } from "../src/core/game";
import { DV, ck, type Dir } from "../src/core/types";
import { passable } from "../src/world/types";
import { reachableCrate } from "../src/core/level1";

export function playWarehouse(g: Game, limit = 500) {
  const w = g.world; if (w.level !== "level-1") throw new Error("warehouse expected");
  let reachedBase = false;
  for (let n = 0; n < limit && !g.run.ended; n++) {
    const r = g.run, zone = g.zoneHere(); reachedBase ||= zone === "alpha";
    const drink = r.inv.find(i => i.id === "almond_water");
    if (drink && r.stats.water < 60) { g.dispatch({ type: "drink", key: drink.key }); continue; }
    const food = r.inv.find(i => i.id === "snack_bar");
    if (food && r.stats.food < 60) { g.dispatch({ type: "eat", key: food.key }); continue; }
    if (zone === "alpha" && !r.l1!.baseClaimed) { g.dispatch({ type: "baseSupplies" }); continue; }
    const useful = (id: string) => id === "almond_water" || id === "snack_bar" || (id === "crowbar" && !g.has("crowbar"));
    const local = [...w.crates.values()].find(c => reachableCrate(r, w, c) && (!c.opened || c.items.some(i => useful(i.id) && g.weight() + g.item(i.id).weight <= 8)));
    if (local) {
      if (!local.opened) { g.dispatch({ type: local.examined || g.meta.clues.includes("warehouse_latch") || g.has("crowbar") ? "crateOpen" : "crateExamine", id: local.id }); continue; }
      const it = local.items.find(i => useful(i.id) && g.weight() + g.item(i.id).weight <= 8);
      if (it) { g.dispatch({ type: "crateTake", id: local.id, key: it.key }); continue; }
    }
    if (zone === "alpha" && r.stats.awake > 18 * 60) { g.dispatch({ type: "rest", hours: 8 }); continue; }
    const returnBase = !reachedBase || r.stats.awake > 18 * 60;
    const target = returnBase ? { i: w.base[0], j: w.base[1] } : [...w.crates.values()]
      .filter(c => !c.opened || c.items.some(i => useful(i.id) && g.weight() + g.item(i.id).weight <= 8))
      .sort((a, b) => Math.abs(a.i - r.pos.i) + Math.abs(a.j - r.pos.j) - Math.abs(b.i - r.pos.i) - Math.abs(b.j - r.pos.j))[0];
    if (!target) { g.dispatch({ type: "move", d: r.pos.d }); continue; }
    const queue = [{ i: r.pos.i, j: r.pos.j, first: null as Dir | null }], seen = new Set([ck(r.pos.i, r.pos.j)]);
    let dir: Dir | null = null;
    for (let k = 0; k < queue.length && k < 2500; k++) {
      const p = queue[k]; if (p.i === target.i && p.j === target.j) { dir = p.first; break; }
      for (let d = 0; d < 4; d++) {
        const i = p.i + DV[d][0], j = p.j + DV[d][1], key = ck(i, j);
        if (seen.has(key) || !passable(w.edgeAt(p.i, p.j, d))) continue;
        seen.add(key); queue.push({ i, j, first: p.first ?? d as Dir });
      }
    }
    if (dir === null) g.dispatch({ type: "rest", hours: 2 });
    else g.dispatch({ type: "move", d: dir });
  }
  return { reachedBase, hours: (g.run.time - g.run.l1!.enteredAt) / 60 };
}
