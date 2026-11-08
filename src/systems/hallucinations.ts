/* Perceptions are decided once by the engine and saved. Audio and UI never roll for them. */
import { sstep, T, type Text } from "../core/types";
import type { HallucinationRecord, RunState } from "../state/types";
import type { Level0, Zone } from "../world/level0";
import { H } from "./survival";

export const PIANO_CAPTION = T("〔很遠的地方，有人在彈鋼琴〕", "[Far away, someone is playing piano]");
export const PIANO_AUDIBLE = .1;
export const PIANO_LIFETIME = 3 * H;
export const PIANO_COOLDOWN = 6 * H;
export const LIE_COOLDOWN = H;
const VAGUE_TIME = [T("一會兒", "a moment"), T("一陣子", "a while"), T("好一陣子", "quite a while"), T("幾個小時", "a few hours"), T("很久很久", "a long, long time")];
const timeBand = (m: number) => m < 12 ? 0 : m < 40 ? 1 : m < 100 ? 2 : m < 300 ? 3 : 4;
export const vagueDuration = (minutes: number): Text => VAGUE_TIME[timeBand(minutes)];
export const lieChance = (sanity: number) => sanity >= 35 ? 0 : .1 + .2 * Math.min(1, Math.max(0, (35 - sanity) / 25));
const reliable = (z: Zone) => z === "arch" || z === "manila";

/** Both sources share gain, timbre and the audibility threshold. Only the false source fades on approach. */
export function pianoLevels(r: RunState, w: Level0) {
  const { i, j } = r.pos, z = w.zone(i, j), dm = w.manilaDist(i, j);
  const realNear = 1 - sstep(1.5, 7, dm), f = r.fakePiano;
  let fakeNear = 0;
  if (f && r.time < f.until && r.stats.sanity < 50 && !reliable(z) && dm >= 8) {
    const distance = Math.hypot(f.i - i, f.j - j);
    fakeNear = (1 - sstep(1.5, 7, distance)) * sstep(1.5, 2.5, distance);
  }
  const near = Math.max(realNear, fakeNear);
  return { real: z === "manila" ? .8 : .65 * realNear, fake: .65 * fakeNear,
    piano: z === "manila" ? .8 : .65 * near, cut: z === "manila" ? 5200 : 280 + 1500 * near * near };
}

export interface PerceptionAction {
  action: "move" | "search" | "rest" | null;
  minutes: number;
  previousSanity: number;
  important: boolean;
}
export interface PerceptionOutcome { say: Text[]; caption?: Text; sfx?: string; perceivedTime?: Text }

export function rememberHallucination(r: RunState, kind: HallucinationRecord["kind"], text: Text, actualMinutes?: number) {
  r.halluc.history.push({ id: ++r.halluc.serial, t: r.time, kind, text, ...(actualMinutes === undefined ? {} : { actualMinutes }) });
  if (r.halluc.history.length > 50) r.halluc.history.splice(0, r.halluc.history.length - 50);
  r.halluc.needsReflection = true;
}

function hearFakePiano(r: RunState, w: Level0) {
  if (r.fakePiano && !r.fakePiano.heard && pianoLevels(r, w).fake > PIANO_AUDIBLE) {
    r.fakePiano.heard = true; rememberHallucination(r, "piano", PIANO_CAPTION);
  }
}

/** Called only after an action has advanced game time; all draws use the supplied halluc stream. */
export function perceive(r: RunState, w: Level0, action: PerceptionAction, rand: () => number): PerceptionOutcome {
  const out: PerceptionOutcome = { say: [] };
  const { i, j } = r.pos, z = w.zone(i, j), safe = reliable(z), nearReal = w.manilaDist(i, j) < 8;
  const f = r.fakePiano;
  if (f) {
    const close = Math.hypot(f.i - i, f.j - j) <= 1.5;
    if (close || r.time >= f.until || r.stats.sanity >= 50 || safe || nearReal) {
      r.fakePiano = null; r.halluc.pianoAfter = r.time + PIANO_COOLDOWN;
      if (!nearReal && !safe && (f.heard || close)) out.say.push(close
        ? T("琴聲停了。這裡什麼都沒有。", "The piano stops. There is nothing here.")
        : T("琴聲慢慢淡了。再也聽不到。", "The piano fades. You can't hear it any more."));
    } else hearFakePiano(r, w);
  }
  if (action.previousSanity < 50 && r.stats.sanity >= 50 && r.halluc.needsReflection) {
    r.halluc.needsReflection = false;
    if (rand() < .5) out.say.push(T("你不確定剛才看到的是不是真的。", "You're not sure what you saw earlier was real."));
  }
  if (action.minutes <= 0 || action.important || r.ended || r.pendingEvent || r.stats.sanity >= 35 || safe || out.say.length) return out;

  if (action.action === "move" && !r.fakePiano && !nearReal && r.time >= r.halluc.pianoAfter && rand() < .08) {
    const candidates: [number, number][] = [];
    for (let di = -8; di <= 8; di++) for (let dj = -8; dj <= 8; dj++) {
      const distance = Math.hypot(di, dj); if (distance < 4 || distance > 8) continue;
      const a = i + di, b = j + dj, zone = w.zone(a, b);
      if ((zone === "hall" || zone === "pillar") && w.manilaDist(a, b) >= 8) candidates.push([a, b]);
    }
    if (candidates.length) {
      const [a, b] = candidates[Math.floor(rand() * candidates.length)];
      r.fakePiano = { i: a, j: b, until: r.time + PIANO_LIFETIME, heard: false };
      hearFakePiano(r, w);
      return out;
    }
  }
  if (!action.action || r.time < r.halluc.lieAfter) return out;
  const kinds: ("sound" | "memory" | "time")[] = [];
  if (action.action === "move") {
    if (z === "hall") kinds.push("memory");
    if (!r.fakePiano && pianoLevels(r, w).real <= PIANO_AUDIBLE) kinds.push("sound");
  }
  if (!r.inv.some(x => x.id === "watch")) kinds.push("time");
  if (!kinds.length || rand() >= lieChance(r.stats.sanity)) return out;
  const kind = kinds[Math.floor(rand() * kinds.length)];
  r.halluc.lieAfter = r.time + LIE_COOLDOWN;
  switch (kind) {
    case "sound": {
      const sounds = [
        { text: T("〔遠處有腳步聲〕", "[Footsteps in the distance]"), sfx: "distant_steps" },
        { text: T("〔身後傳來兩下敲擊聲〕", "[Two knocks from behind you]"), sfx: "distant_knocks" }
      ];
      const sound = sounds[Math.floor(rand() * sounds.length)];
      out.caption = sound.text; out.sfx = sound.sfx; rememberHallucination(r, kind, sound.text); break;
    }
    case "memory": {
      const text = rand() < .5 ? T("這裡你好像來過。你記得這個轉角。", "You think you have been here before. You remember this corner.")
        : T("你記得在這段走廊停過很久。但想不起來是什麼時候。", "You remember stopping in this corridor for a long time. You can't remember when.");
      out.say.push(text); rememberHallucination(r, kind, text); break;
    }
    case "time": {
      const choices = VAGUE_TIME.filter((_, band) => Math.abs(band - timeBand(action.minutes)) >= 2);
      out.perceivedTime = choices[Math.floor(rand() * choices.length)];
      rememberHallucination(r, kind, out.perceivedTime, action.minutes); break;
    }
  }
  return out;
}
