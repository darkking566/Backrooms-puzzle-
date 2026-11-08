/* Warehouse commands. Shared inventory/survival commands remain in Game. No UI or renderer dependencies. */
import { ck, DV, T, type Text } from "./types";
import type { Command, Outcome } from "./game";
import type { ContentData } from "../../tools/content-schema";
import type { RunState } from "../state/types";
import type { Level1, SupplyCrate } from "../world/level1";
import type { Activity } from "../systems/survival";
import { edgeKey, passable } from "../world/types";

export interface WarehouseContext {
  run: RunState; world: Level1; content: ContentData; out: Outcome;
  say(t: Text, kind?: "event" | "warn" | "caption"): void;
  pass(minutes: number, activity?: Activity): boolean;
  rand(): number;
  discover(id: string): void;
  knows(id: string): boolean;
  learn(id: string): void;
  weight(): number;
  meetElder(): void;
}
export const reachableCrate = (r: RunState, w: Level1, c: SupplyCrate) => (c.i === r.pos.i && c.j === r.pos.j)
  || (w.zone(r.pos.i, r.pos.j) === "alpha" && w.zone(c.i, c.j) === "alpha");
const level0Only = new Set(["door", "flicker", "pit", "ceiling", "salt", "wring", "examine", "choose", "cabinetTake", "cabinetPut", "writeNote", "packExamine", "packMarks", "packAttempt", "packUnjam", "packForce", "packTake", "roomPersonTalk", "roomPersonChoice"]);
const directions = [T("北方", "north"), T("東方", "east"), T("南方", "south"), T("西方", "west")];
export function warehouseCommand(x: WarehouseContext, cmd: Command): boolean {
  const { run: r, world: w, content: c, out } = x, rules = w.rules;
  const has = (id: string) => r.inv.some(i => i.id === id);
  if (level0Only.has(cmd.type)) return true;
  switch (cmd.type) {
    case "wait": x.say(c.hazards[0].text.wait); x.pass(5); return true;
    case "touch": {
      const near = [0, 1, 2, 3].some(d => cmd.edge === edgeKey(r.pos.i, r.pos.j, d));
      if (near) { x.pass(1); if (!r.ended) x.say(T("水泥是冷的。指尖沾了一層灰。", "The concrete is cold. Dust clings to your fingertips.")); }
      return true;
    }
    case "move": {
      if (!passable(w.edgeAt(r.pos.i, r.pos.j, cmd.d))) return true;
      const from = { ...r.pos }, previous = w.zone(from.i, from.j);
      r.pos = { i: from.i + DV[cmd.d][0], j: from.j + DV[cmd.d][1], d: cmd.d }; r.moves++;
      w.ensureAround(r.pos.i, r.pos.j); out.anim = { kind: "move", from, d: cmd.d }; out.rebuild = true;
      x.pass(10 + Math.floor(x.rand() * 7) + (r.l1?.power.phase === "blackout" && w.zone(r.pos.i, r.pos.j) !== "alpha" && !(has("flashlight") && r.flashlightOn) ? 8 : 0), "walk"); if (r.ended) return true;
      const zone = w.zone(r.pos.i, r.pos.j);
      if (zone !== previous) { x.say(rules.zones[zone]); if (zone === "alpha") { x.discover("base_alpha"); r.l1!.baseVisits++; x.meetElder(); out.important = true; } }
      if (w.corpse?.[0] === r.pos.i && w.corpse[1] === r.pos.j) x.say(T("水泥柱旁躺著一具遺體。", "A body lies beside the concrete pillar."), "warn");
      return true;
    }
    case "turn": {
      const from = { ...r.pos }; r.pos.d = ((r.pos.d + cmd.dir + 4) % 4) as typeof r.pos.d;
      out.anim = { kind: "turn", from, dir: cmd.dir }; x.pass(1);
      if (!r.ended && cmd.dir === 2) x.say(T("你回頭看。柱子和來時的路還在。", "You look back. The pillars and the way here are still there."));
      return true;
    }
    case "rest": {
      if (![2, 4, 8].includes(cmd.hours)) return true;
      const safe = w.zone(r.pos.i, r.pos.j) === "alpha";
      x.say(safe ? rules.base.rest : rules.base.outsideRest);
      x.pass(cmd.hours * 60, r.stats.awake > 6 * 60 ? "sleep" : "idle");
      return true;
    }
    case "search": {
      const cell = w.cells.get(ck(r.pos.i, r.pos.j))!;
      if (!x.pass(30) || r.ended) return true;
      if (r.l1?.power.phase === "blackout" && w.zone(cell.i, cell.j) !== "alpha" && !(has("flashlight") && r.flashlightOn)) { x.say(T("黑暗裡看不清箱子與木板。", "You cannot make out the crates and boards in the dark.")); return true; }
      if (cell.searched) { x.say(T("這一帶你已經翻過了。", "You have already been over this area.")); return true; }
      cell.searched = true;
      const mayFind = w.zone(cell.i, cell.j) !== "alpha" && w.inSupplyArea(cell.i, cell.j) && r.l1!.searches < rules.supplies.searchLimit;
      if (mayFind) r.l1!.searches++;
      if (mayFind && x.rand() < rules.supplies.searchChance) {
        const pool = ["snack_bar", "almond_water", "bandage", "flashlight", "notebook", "bottle"], id = pool[Math.floor(x.rand() * pool.length)];
        cell.items.push({ key: `l1:search:${cell.i},${cell.j}`, id, x: .3, z: .2,
          bottle: id === "bottle" ? w.rollBottle(cell.i, cell.j, 0) : undefined });
        x.say(T("木板下面壓著一件東西。", "Something lies beneath the boards.")); out.rebuild = true;
      } else x.say(!w.inSupplyArea(cell.i, cell.j) || r.l1!.searches >= rules.supplies.searchLimit
        ? T("這裡的紙盒早已翻空。告示上的補給只在基地附近，不會一直補上。", "These cartons were emptied long ago. The supplies on the notice are near the base, and do not keep replenishing.")
        : T("你翻過木板和空紙盒。只有灰塵。", "You turn over boards and empty cartons. Only dust."));
      return true;
    }
    case "readGuide":
      if (w.zone(r.pos.i, r.pos.j) === "arrival" || w.zone(r.pos.i, r.pos.j) === "alpha") { x.say(rules.guide); out.important = true; }
      return true;
    case "readSign": {
      const d = w.routeMark(r.pos.i, r.pos.j); if (d === null) return true;
      x.say({ zh: rules.sign.zh.replace("{direction}", directions[d].zh), en: rules.sign.en.replace("{direction}", directions[d].en) });
      out.important = true; return true;
    }
    case "baseSupplies": {
      if (w.zone(r.pos.i, r.pos.j) !== "alpha" || !r.l1) return true;
      if (r.l1.baseClaimed) { x.say(rules.base.claimed); return true; }
      x.pass(1); if (r.ended) return true;
      r.l1.baseClaimed = true;
      w.crates.set("base", { id: "base", i: w.base[0], j: w.base[1], kind: "base", examined: true, opened: true,
        items: rules.supplies.base.flatMap(a => Array.from({ length: a.count }, (_, n) => ({ key: `l1:base:${a.item}:${n}`, id: a.item }))) });
      x.say(rules.base.supplies); out.rebuild = true; out.important = true; return true;
    }
    case "crateExamine": case "crateOpen": case "crateTake": {
      const crate = w.crates.get(cmd.id); if (!crate || !reachableCrate(r, w, crate)) return true;
      if (cmd.type === "crateExamine") {
        x.say(rules.crate.description);
        if (!crate.examined) { if (!x.pass(rules.crate.examineMinutes)) return true; if (r.ended) return true; crate.examined = true; }
        x.say(rules.crate.latch); x.learn("warehouse_latch"); out.important = true;
      } else if (cmd.type === "crateOpen") {
        if (crate.opened) return true;
        if (!crate.examined && !x.knows("warehouse_latch") && !has("crowbar")) { x.say(rules.crate.needLatch); return true; }
        if (!x.pass(has("crowbar") ? rules.crate.crowbarMinutes : rules.crate.openMinutes)) return true; if (r.ended) return true;
        crate.opened = true; x.say(rules.crate.opened); x.discover("supply_crate"); out.rebuild = true;
      } else {
        const it = crate.items.find(a => a.key === cmd.key); if (!crate.opened || !it) return true;
        if (x.weight() + c.items.find(a => a.id === it.id)!.weight > 8) { x.say(T("拿不動了。得先放下一些東西。", "You can't carry any more. Put something down first.")); return true; }
        x.pass(1); if (r.ended) return true;
        crate.items = crate.items.filter(a => a.key !== it.key); r.inv.push(it);
        const name = c.items.find(a => a.id === it.id)!.name;
        x.say(T(`你拿走了${name.zh}。`, `You take the ${name.en.toLowerCase()}.`));
      }
      return true;
    }
    default: return false;
  }
}
