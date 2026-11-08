/* The encounter is a person, not a hallucination. Counts select only the two authored greetings. */
import type { DialogueChoice, QuestData } from "../../tools/content-schema";
import { newRoomPersonRun, type InvItem, type Meta, type RoomPersonRun } from "../state/types";

export function sealedGreyWater(x: InvItem): boolean {
  return x.id === "almond_water" || (x.id === "bottle" && !!x.bottle && x.bottle.full && x.bottle.sealed && x.bottle.color === "grey" && x.bottle.liquid === "aw_grey");
}
export function planRoomPerson(q: QuestData, m: Meta, rand: () => number): RoomPersonRun {
  const r = newRoomPersonRun(), phase = m.roomPerson.phase;
  if (m.runs < q.spawn.minRun || !m.discoveries.includes(q.spawn.requiresDiscovery) || phase === "complete") return r;
  r.eligible = true;
  if (phase === "aftermath") r.variant = "aftermath";
  else {
    const cfg = phase === "first" ? q.spawn : q.revisit;
    if (m.roomPerson.misses >= cfg.pityAfterMisses || rand() < cfg.chance) { r.variant = phase; r.present = true; }
  }
  return r;
}
export function personReady(r: RoomPersonRun) { return r.variant === "revisit" || r.helped; }
export function personChoiceVisible(ch: DialogueChoice, r: RoomPersonRun): boolean {
  switch (ch.when) {
    case "needs_water": return r.variant === "first" && !r.helped;
    case "ready": return personReady(r);
    case "ready_unpromised": return personReady(r) && !r.promised;
    case "not_waited": return !r.waited;
    case "always": return true;
  }
}
