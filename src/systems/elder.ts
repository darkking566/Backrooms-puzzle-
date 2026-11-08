import type { ElderData } from "../../tools/content-schema";
import type { Meta, RunState } from "../state/types";
import type { Text } from "../core/types";
import { queueReward } from "./rewards";

export function meetElder(r: RunState, m: Meta, n: ElderData): Text[] {
  const e = r.l1?.elder; if (!e || e.met) return [];
  e.met = true; e.meeting = ++m.elder.meetings;
  if (!r.npcSeenThisRun.includes(n.person)) { r.npcSeenThisRun.push(n.person); m.npcMeetings[n.person] = (m.npcMeetings[n.person] ?? 0) + 1; }
  return [n.text.arrival, e.meeting > 1 ? n.text.again : n.text.first,
    ...((m.npcMeetings[n.person] ?? 0) > 1 && e.meeting === 1 ? [n.text.familiar] : [])];
}
export function elderChoiceVisible(r: RunState, m: Meta, ch: ElderData["choices"][number]): boolean {
  return !!r.l1?.elder.met && (r.l1.elder.meeting ?? 0) >= ch.minMeetings
    && (!ch.requiresClue || m.clues.includes(ch.requiresClue)) && (!ch.requiresFlag || m.roomPerson.flags[ch.requiresFlag]);
}
export function hearElder(r: RunState, m: Meta, n: ElderData, id: string): Text[] {
  const ch = n.choices.find(x => x.id === id); if (!ch || !elderChoiceVisible(r, m, ch)) return [];
  if (ch.clue && !m.clues.includes(ch.clue)) m.clues.push(ch.clue);
  if (ch.clue === n.reward.clue && !m.elder.rewardClaimed) {
    m.elder.rewardClaimed = true; queueReward(r, "elder:first-fragment", n.text.reward, n.reward.points);
  }
  return [ch.result];
}
