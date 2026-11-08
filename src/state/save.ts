/* Saving goes through a small Store interface (IndexedDB now, a server later for multiplayer).
   Every action saves; a run can be left and resumed, and a reload never undoes a death. */
import { newHallucinations, newMeta, newRoomPersonRun, SAVE_VERSION, type Meta, type RunState, type Corpse } from "./types";

export interface Store { get(key: string): Promise<unknown>; set(key: string, v: unknown): Promise<void>; del(key: string): Promise<void> }

class IdbStore implements Store {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((ok, bad) => { const r = indexedDB.open("backrooms-echo", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
  }
  private tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.db.then(db => new Promise<T>((ok, bad) => { const q = f(db.transaction("kv", mode).objectStore("kv")); q.onsuccess = () => ok(q.result); q.onerror = () => bad(q.error); }));
  }
  get(k: string) { return this.tx("readonly", s => s.get(k)); }
  async set(k: string, v: unknown) { await this.tx("readwrite", s => s.put(v, k)); }
  async del(k: string) { await this.tx("readwrite", s => s.delete(k)); }
}
class LocalStore implements Store {
  async get(k: string) { try { const v = localStorage.getItem("backrooms-echo:" + k); return v ? JSON.parse(v) : undefined; } catch { return undefined; } }
  async set(k: string, v: unknown) { try { localStorage.setItem("backrooms-echo:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  async del(k: string) { try { localStorage.removeItem("backrooms-echo:" + k); } catch { /* ignore */ } }
}
class MemoryStore implements Store { m = new Map<string, unknown>(); async get(k: string) { return this.m.get(k); } async set(k: string, v: unknown) { this.m.set(k, v); } async del(k: string) { this.m.delete(k); } }

let store: Store = new MemoryStore();
export async function openStore(): Promise<Store> {
  try { const s = new IdbStore(); await s.get("probe"); store = s; } catch { store = typeof localStorage !== "undefined" ? new LocalStore() : new MemoryStore(); }
  return store;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function migrateMeta(m: (Partial<Meta> & { corpse?: Corpse | null }) | undefined): Meta {
  const base = newMeta();
  if (!m || typeof m !== "object") return base;
  const { corpse, ...rest } = m;
  return { ...base, ...rest,
    corpses: { ...(m.corpses ?? (corpse ? { "level-0": corpse } : {})) },
    symbolLock: { ...base.symbolLock, ...m.symbolLock },
    roomPerson: { ...base.roomPerson, ...m.roomPerson, flags: { ...base.roomPerson.flags, ...m.roomPerson?.flags } },
    npcMeetings: { ...base.npcMeetings, ...m.npcMeetings },
    settings: { ...base.settings, ...(m.settings ?? {}) }, v: SAVE_VERSION };
}
export async function loadMeta(): Promise<Meta> { return migrateMeta((await store.get("meta")) as Partial<Meta> | undefined); }
function runDefaults(r: RunState): RunState {
  r.level ??= "level-0";
  r.mapPages ??= []; r.l1 ??= null; r.flashlightOn ??= true;
  r.pendingRewards ??= [];
  r.npcSeenThisRun ??= r.roomPerson?.entered && (r.roomPerson.variant === "first" || r.roomPerson.variant === "revisit") ? ["manila_stranger"] : [];
  r.map ??= {}; r.mapMarks ??= {}; r.lastNotebookRead ??= null;
  r.fakePiano ??= null;
  r.halluc = { ...newHallucinations(), ...r.halluc };
  r.halluc.history = (r.halluc.history ?? []).slice(-50);
  r.halluc.serial = Math.max(r.halluc.serial, ...r.halluc.history.map(x => x.id));
  r.rng.counters.halluc ??= 0;
  r.rng.counters.puzzles ??= 0;
  r.packPlan ??= "none"; r.lockedPack ??= null;
  r.rng.counters.quests ??= 0;
  r.roomPerson = { ...newRoomPersonRun(), ...r.roomPerson };
  return r;
}
export async function loadRun(): Promise<RunState | null> { const r = (await store.get("run")) as RunState | undefined; return r && r.v === SAVE_VERSION && !r.ended ? runDefaults(r) : null; }
let chain = Promise.resolve();
export function persist(meta: Meta, run: RunState | null) {   // serialised so saves never interleave
  const m = clone(meta), r = run ? clone(run) : null;
  chain = chain.then(() => store.set("meta", m)).then(() => (r && !r.ended ? store.set("run", r) : store.del("run"))).catch(() => {});
  return chain;
}
export function exportSave(meta: Meta, run: RunState | null): string { return btoa(unescape(encodeURIComponent(JSON.stringify({ app: "backrooms-echo", v: SAVE_VERSION, meta, run })))); }
export function importSave(text: string): { meta: Meta; run: RunState | null } {
  const o = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
  if (o.app !== "backrooms-echo") throw new Error("not a save");
  return { meta: migrateMeta(o.meta), run: o.run && o.run.v === SAVE_VERSION ? runDefaults(o.run) : null };
}
export async function wipe() { await store.del("meta"); await store.del("run"); }
