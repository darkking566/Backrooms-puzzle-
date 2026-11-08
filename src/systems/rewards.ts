import type { RunState } from "../state/types";
import type { ContentData } from "../../tools/content-schema";
import { T, type Text } from "../core/types";
export function queueReward(r: RunState, id: string, label: Text, points: number) {
  if (!r.pendingRewards.some(x => x.id === id)) r.pendingRewards.push({ id, label, points });
}
export function warehouseSurvival(r: RunState, c: ContentData): { label: Text; pts: number }[] {
  if (!r.l1) return [];
  const t0 = r.l1.enteredAt, t1 = Math.max(0, r.time - t0), rule = c.rewards[0], result: { label: Text; pts: number }[] = [];
  const days = Math.floor(t0 / 1440), hours = Math.floor(t0 / 60);
  if (days) result.push({ label: T(`在 Level 0 撐過了 ${days} 天`, `Survived ${days} days in Level 0`), pts: days * 10 });
  if (hours >= 6) result.push({ label: T(`在 Level 0 待了 ${hours} 小時`, `${hours} hours in Level 0`), pts: Math.floor(hours / 6) * 2 });
  const score = Math.min(rule.survivalCap, Math.floor(rule.survivalMultiplier * (Math.floor(t1 / 1440) * 10 + Math.floor(t1 / 360) * 2)));
  if (score) result.push({ label: T(`在 Level 1 待了 ${Math.floor(t1 / 60)} 小時`, `${Math.floor(t1 / 60)} hours in Level 1`), pts: score });
  return result;
}
