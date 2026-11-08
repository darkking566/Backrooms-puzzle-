/* Survival over time. Rates are per hour and follow DESIGN §5.1: about 72 h without water at rest, walking ×1.5,
   a full stomach lasts about three days of reserve (hunger hurts, but water kills first), trouble after 24 h awake. Everything runs through tick(). */
import type { RunState } from "../state/types";
import type { AnyZone } from "../world/types";

export type Activity = "idle" | "walk" | "sleep";
export interface Env { zone: AnyZone; dark: boolean; redK: number; manilaK: number; inLevel0: boolean; sanityRate?: number; shelterRecovery?: number }
const clamp = (x: number) => Math.max(0, Math.min(100, x));
export const H = 60;

export function hasStatus(r: RunState, s: string) { const e = r.status[s]; return e !== undefined && (e < 0 || e > r.time); }
export function addStatus(r: RunState, s: string, hours: number | null) { r.status[s] = hours === null ? -1 : Math.max(r.status[s] ?? 0, r.time + hours * H); }
export function clearStatus(r: RunState, s: string) { delete r.status[s]; }

/** Advance time. Returns the cause of death if this killed you. */
export function tick(r: RunState, minutes: number, act: Activity, env: Env): string | null {
  const s = r.stats;
  for (let m = 0; m < minutes; m++) {                        // minute steps keep thresholds exact; runs are short
    const h = 1 / H;
    s.water = clamp(s.water - h * (100 / 72) * (act === "walk" ? 1.5 : act === "sleep" ? .8 : 1));
    s.food = clamp(s.food - h * 1.4 * (act === "sleep" ? .8 : 1));
    if (act === "sleep") s.awake = Math.max(0, s.awake - 2); else s.awake += 1;
    // sanity: the hum, isolation and darkness wear you down; the Manila Room and sleep give some back
    let ds = env.sanityRate ?? (env.inLevel0 ? -.8 : -.3);
    if (env.dark && env.sanityRate === undefined) ds *= 3;
    ds -= 1.5 * env.redK;
    if (s.awake > 24 * H) ds -= 1;
    if (hasStatus(r, "hearing_damage")) ds -= .3;
    if (act === "sleep" && !env.dark) ds = 1.5;
    if (env.manilaK > 0) ds = Math.max(ds, 6 * env.manilaK);
    if (env.shelterRecovery) ds = Math.max(ds, env.shelterRecovery);
    s.sanity = clamp(s.sanity + ds * h);
    // the Wretched Cycle: hunger, thirst and sleeplessness feed it; isolation (Level 0) speeds it up
    let dw = 0;
    if (s.water < 25) dw += .8; if (s.food < 10) dw += 1; if (s.awake > 30 * H) dw += .8;
    if (env.inLevel0) dw *= 1.3;
    if (dw === 0 && s.water > 50 && s.food > 40 && s.awake < 20 * H && s.wretched < 65) dw = -.4;
    s.wretched = clamp(s.wretched + dw * h);
    // health
    let dh = 0;
    if (s.water <= 0) dh -= 4.2;
    if (hasStatus(r, "infection")) dh -= .6;
    if (hasStatus(r, "bleeding")) dh -= 3;
    if (dh === 0 && s.water > 30 && s.food > 20) dh = .5;
    s.health = clamp(s.health + dh * h);
    r.time += 1;
    if (s.wretched >= 100) return "death_wretch";
    if (s.health <= 0) return s.water <= 0 ? "death_dehydration" : "death_injury";
  }
  return null;
}

/* ---------- how your body feels (no numbers, DESIGN §8) ---------- */
export interface Feeling { id: "water" | "food" | "awake" | "sanity" | "health" | "wretched" | "status"; level: 0 | 1 | 2 | 3; zh: string; en: string }
export function feelings(r: RunState): Feeling[] {
  const s = r.stats, out: Feeling[] = [];
  const add = (id: Feeling["id"], level: Feeling["level"], zh: string, en: string) => { if (level > 0) out.push({ id, level, zh, en }); };
  add("water", s.water < 10 ? 3 : s.water < 25 ? 2 : s.water < 45 ? 1 : 0,
    s.water < 10 ? "嘴唇裂開了，眼前一陣一陣發黑。" : s.water < 25 ? "喉嚨乾得發痛，吞口水都很難。" : "喉嚨有點乾。",
    s.water < 10 ? "Your lips are cracked and your vision keeps going dark." : s.water < 25 ? "Your throat is painfully dry; even swallowing is hard." : "Your throat is a little dry.");
  add("food", s.food < 10 ? 3 : s.food < 25 ? 2 : s.food < 45 ? 1 : 0,
    s.food < 10 ? "餓到手在發抖，胃已經不痛了，只是空。" : s.food < 25 ? "胃一陣一陣地絞痛。" : "肚子有點餓。",
    s.food < 10 ? "So hungry your hands shake. Your stomach no longer hurts; it is only empty." : s.food < 25 ? "Your stomach cramps in waves." : "You are a little hungry.");
  const aw = s.awake / H;
  add("awake", aw > 30 ? 3 : aw > 22 ? 2 : aw > 16 ? 1 : 0,
    aw > 30 ? "你剛才好像站著睡著了一下。" : aw > 22 ? "眼皮很重，腳步開始飄。" : "有點睏。",
    aw > 30 ? "You think you just fell asleep standing up." : aw > 22 ? "Your eyelids are heavy and your steps drift." : "You are a little sleepy.");
  add("sanity", s.sanity < 20 ? 3 : s.sanity < 35 ? 2 : s.sanity < 60 ? 1 : 0,
    s.sanity < 20 ? "你分不清嗡嗡聲是外面的，還是你腦袋裡的。" : s.sanity < 35 ? "眼角一直有東西在動。你不敢轉頭去看。" : "嗡嗡聲讓你很煩躁。",
    s.sanity < 20 ? "You can no longer tell whether the hum is out there or inside your head." : s.sanity < 35 ? "Something keeps moving at the edge of your vision. You don't dare look." : "The hum is getting on your nerves.");
  add("health", s.health < 25 ? 3 : s.health < 50 ? 2 : s.health < 75 ? 1 : 0,
    s.health < 25 ? "全身都在痛，每一步都很勉強。" : s.health < 50 ? "身體很不舒服。" : "身上有點痛。",
    s.health < 25 ? "Everything hurts; every step is an effort." : s.health < 50 ? "You feel unwell." : "You ache a little.");
  add("wretched", s.wretched >= 65 ? 3 : s.wretched >= 30 ? 2 : s.wretched >= 15 ? 1 : 0,
    s.wretched >= 65 ? "皮膚一碰就剝落。你一直想著水，想著吃的，其他的事越來越模糊。" : s.wretched >= 30 ? "手臂上起了紅疹，癢得受不了。你變得很容易煩躁。" : "皮膚有點癢。",
    s.wretched >= 65 ? "Your skin comes away at a touch. You think only of water and food; everything else blurs." : s.wretched >= 30 ? "A red rash on your arms, maddeningly itchy. You snap at nothing." : "Your skin itches a little.");
  if (hasStatus(r, "bleeding")) out.push({ id: "status", level: 2, zh: "傷口還在流血。", en: "The wound is still bleeding." });
  if (hasStatus(r, "infection")) out.push({ id: "status", level: 2, zh: "身體發熱，傷口或胃裡有東西不對勁。", en: "You run hot; something is wrong in a wound or your gut." });
  if (hasStatus(r, "hearing_damage")) out.push({ id: "status", level: 1, zh: "耳朵一直在響，聲音都悶悶的。", en: "Your ears keep ringing; everything sounds muffled." });
  return out;
}
