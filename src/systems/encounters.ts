/* Saved power/threat states. A warning or new encounter always yields to another player decision. */
import type { HazardData } from "../../tools/content-schema";
import type { RunState } from "../state/types";
import type { Level1 } from "../world/level1";
import { DV, ck, type Dir, type Text } from "../core/types";
import { hasTorch } from "./lighting";
import { passable } from "../world/types";
import type { Activity } from "./survival";

export interface HazardHooks {
  rand(): number;
  tick(minutes: number, activity: Activity): boolean;
  say(t: Text): void;
  signal(t: Text, sound?: string, visual?: boolean): void;
}
const between = (range: [number, number], rand: () => number) => range[0] + Math.floor(rand() * (range[1] - range[0] + 1));
function transition(r: RunState, w: Level1, h: HazardData, hooks: HazardHooks) {
  const l = r.l1!, p = l.power, safe = w.zone(r.pos.i, r.pos.j) === "alpha";
  if (p.phase === "normal") {
    p.phase = "warning"; p.nextAt = r.time + h.power.warning;
    if (!safe) { hooks.say(h.text.warning); hooks.signal(h.text.warningCaption, "rattle"); }
  } else if (p.phase === "warning") {
    p.phase = "blackout"; p.nextAt = r.time + between(h.power.duration, hooks.rand); l.hazards.outages++; p.checked = false; p.lightChecked = false; p.threatSpawned = !!l.encounter;
    const visible = w.visibleFrom([r.pos]);
    for (const crate of [...w.crates.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!crate.opened && !visible.has(ck(crate.i, crate.j)) && hooks.rand() < h.encounter.vanishChance) w.crates.delete(crate.id);
    }
    if (!safe) {
      hooks.say(h.text.blackout); hooks.signal(h.text.blackout, "clunk", true);
      checkThreat(r, w, h, hooks);
    }
  } else {
    p.phase = "normal"; p.nextAt = r.time + between(h.power.interval, hooks.rand);
    if (!safe) { hooks.say(h.text.relight); hooks.signal(h.text.relight, "relight", true); }
  }
}
function checkThreat(r: RunState, w: Level1, h: HazardData, hooks: HazardHooks): boolean {
  const l = r.l1!, p = l.power;
  if (p.phase !== "blackout" || p.threatSpawned || l.encounter || w.zone(r.pos.i, r.pos.j) === "alpha") return false;
  const light = hasTorch(r);
  if (p.checked && (!light || p.lightChecked)) return false;
  p.checked = true; if (light) p.lightChecked = true;
  if (hooks.rand() >= (light ? h.encounter.lightChance : h.encounter.chance)) return false;
  const back = ((r.pos.d + 2) % 4) as Dir;
  const retreat = [back, 0, 1, 2, 3].find(d => passable(w.edgeAt(r.pos.i, r.pos.j, d)))!;
  const direction = [r.pos.d, 0, 1, 2, 3].find(d => d !== retreat && passable(w.edgeAt(r.pos.i, r.pos.j, d))) ?? r.pos.d;
  l.encounter = { phase: "noticed", direction: direction as Dir, retreat: { i: r.pos.i + DV[retreat][0], j: r.pos.j + DV[retreat][1] } };
  p.threatSpawned = true; l.hazards.noticed++;
  hooks.say(light ? h.text.noticedLit : h.text.noticedDark); hooks.signal(light ? h.text.litCaption : h.text.darkCaption, undefined, true);
  return true;
}
/** Returns false when a long action was interrupted; unfinished work must not yield loot. */
export function advanceWarehouse(r: RunState, w: Level1, h: HazardData, minutes: number, activity: Activity, hooks: HazardHooks): boolean {
  const p = r.l1!.power;
  if (!p.nextAt) p.nextAt = r.time + between(h.power.first, hooks.rand);
  const target = r.time + minutes, long = minutes >= 10;
  if (checkThreat(r, w, h, hooks) && long) return false;
  while (r.time < target) {
    if (p.nextAt <= r.time) {
      transition(r, w, h, hooks);
      if (long && w.zone(r.pos.i, r.pos.j) !== "alpha") return false;
    }
    const step = Math.min(target - r.time, Math.max(1, p.nextAt - r.time));
    if (!hooks.tick(step, activity)) return false;
  }
  if (p.nextAt <= r.time) transition(r, w, h, hooks);
  return true;
}
