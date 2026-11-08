import type { SavedWorld } from "../world/world";
import type { RngState } from "../core/rng";
import type { Dir, Lang, Text } from "../core/types";
import type { Bottle, AnyZone, LevelId } from "../world/types";

export const SAVE_VERSION = 1;

export interface Stats {
  water: number;      // 0..100 hydration
  food: number;       // 0..100 how fed you are
  awake: number;      // minutes since you last slept
  sanity: number;     // 0..100
  wretched: number;   // 0..100 (stage 1 ≥ 30, stage 2 ≥ 65, 100 = a Wretch)
  health: number;     // 0..100
}
export interface InvItem { key: string; id: string; bottle?: Bottle }
export type LockSymbol = "circle" | "triangle" | "square";
export interface LockedPack {
  id: string;
  pos: { i: number; j: number };
  order: LockSymbol[];
  marksOrder: LockSymbol[];
  numbers: Record<LockSymbol, number>;
  seen: boolean;
  hasRuleNote: boolean;
  marksSeen: boolean;
  failures: number;
  jammed: boolean;
  openedBy: "code" | "crowbar" | null;
  items: InvItem[];
  story?: "room_person";
}
export type RoomPersonVariant = "none" | "first" | "revisit" | "aftermath";
export interface RoomPersonRun {
  eligible: boolean; variant: RoomPersonVariant; entered: boolean; greeted: boolean; present: boolean;
  helped: boolean; waited: boolean; promised: boolean; separated: boolean; returned: boolean; rewardPending: boolean;
}
export interface RoomPersonFlags {
  helped: boolean; waited: boolean; promisedAndLeft: boolean; sawOtherLeave: boolean; leftFirst: boolean; returnedEmpty: boolean; returnedWater: boolean;
}
export interface RoomPersonMeta {
  phase: "first" | "revisit" | "aftermath" | "complete";
  misses: number; rewardClaimed: boolean; suppliesGranted: boolean; flags: RoomPersonFlags;
}
export const newRoomPersonRun = (): RoomPersonRun => ({ eligible: false, variant: "none", entered: false, greeted: false, present: false, helped: false, waited: false, promised: false, separated: false, returned: false, rewardPending: false });
export const newRoomPersonMeta = (): RoomPersonMeta => ({ phase: "first", misses: 0, rewardClaimed: false, suppliesGranted: false, flags: { helped: false, waited: false, promisedAndLeft: false, sawOtherLeave: false, leftFirst: false, returnedEmpty: false, returnedWater: false } });
export interface LogLine { t: Text; kind?: "event" | "warn" | "caption" }

export type MapKey = `${number},${number}`;
// Only what you can recognise. Door materials and real/fake flickers are never saved here.
export type MapEdge = "open" | "wall" | "arch" | "door" | "door-open" | "flicker" | "unknown";
export interface MapCell {
  walls: [MapEdge, MapEdge, MapEdge, MapEdge]; // N E S W, copied at the time of drawing
  zone: AnyZone | "unknown";
  t: number;
  ver: number;
  messy: boolean;
  visited: boolean;
}
export type MapMark = { kind: "water" | "danger" | "exit" } | { kind: "custom"; text: string };

export interface FakePiano { i: number; j: number; until: number; heard: boolean }
export interface HallucinationRecord {
  id: number; t: number;
  kind: "piano" | "sound" | "memory" | "time";
  text: Text;
  actualMinutes?: number;
}
export interface Hallucinations {
  pianoAfter: number;
  lieAfter: number;
  needsReflection: boolean;
  serial: number;                         // ids remain unique when old history is trimmed
  history: HallucinationRecord[];
}
export const newHallucinations = (): Hallucinations => ({ pianoAfter: 0, lieAfter: 0, needsReflection: false, serial: 0, history: [] });

export interface MapPage { level: LevelId; map: Record<MapKey, MapCell>; mapMarks: Record<MapKey, MapMark> }
export interface PendingReward { id: string; label: Text; points: number }
export interface Level1Run {
  enteredAt: number;
  power: { phase: "normal" | "warning" | "blackout"; nextAt: number };
  encounter: { phase: "noticed" | "approaching"; retreat: { i: number; j: number } } | null;
  baseClaimed: boolean;
  elder: { met: boolean; meeting: number | null };
}
export interface RunState {
  mapPages: MapPage[];
  l1: Level1Run | null;
  flashlightOn: boolean;
  npcSeenThisRun: string[];
  pendingRewards: PendingReward[];
  level: LevelId;
  v: number;
  seed: number;
  run: number;                      // which awakening this is (what you remember)
  time: number;                     // minutes since you woke
  clock0: number;                   // minutes past midnight when you woke (only a watch shows it)
  stats: Stats;
  status: Record<string, number>;   // status id -> minute it wears off (-1 = until treated)
  inv: InvItem[];
  carried: string[];                // item ids bought before the run (left on the body if you die)
  pos: { i: number; j: number; d: Dir };
  map: Record<MapKey, MapCell>;
  mapMarks: Record<MapKey, MapMark>;
  lastNotebookRead: number | null;
  fakePiano: FakePiano | null;
  halluc: Hallucinations;
  rng: RngState;
  world: SavedWorld;
  moves: number;
  shifted: number;
  outageLeft: number;
  lastOutage: number;
  redStage: number;
  eventsDone: string[];
  pendingEvent: string | null;
  found: string[];                  // first-time discoveries made this run
  log: LogLine[];
  manilaTaken: number;              // flasks taken from the cabinet this run
  packPlan: "none" | "arch" | "manila";
  lockedPack: LockedPack | null;     // independent of evicted/shifted map cells; dials are UI-only
  roomPerson: RoomPersonRun;
  ended: Ended | null;
}
export interface Ended { level?: LevelId; ending: string; points: number; breakdown: { label: Text; pts: number }[]; days: number }

export interface Corpse { run: number; items: InvItem[]; cause: string; note: Text }
export interface Settings { lang: Lang; flash: boolean; sound: boolean; quality: "auto" | "low" | "mid" | "high"; reduceMotion: boolean }
export interface Meta {
  v: number;
  name: string | null;
  runs: number;
  points: number;
  discoveries: string[];
  endings: string[];
  clues: string[];
  notes: { t: string; run: number }[];   // notes left in the Manila Room
  cabinet: InvItem[];                   // what is in the Manila Room cabinet
  corpses: Partial<Record<LevelId, Corpse>>;
  symbolLock: { ruleNoteSeen: boolean; lastCode: string | null };
  roomPerson: RoomPersonMeta;
  npcMeetings: Record<string, number>;
  history: { run: number; ending: string; days: number; points: number }[];
  settings: Settings;
}
export const newMeta = (): Meta => ({
  v: SAVE_VERSION, name: null, runs: 0, points: 0, discoveries: [], endings: [], clues: [], notes: [], cabinet: [], corpses: {}, history: [],
  symbolLock: { ruleNoteSeen: false, lastCode: null },
  roomPerson: newRoomPersonMeta(), npcMeetings: {},
  settings: { lang: "zh", flash: false, sound: false, quality: "auto", reduceMotion: false }
});
