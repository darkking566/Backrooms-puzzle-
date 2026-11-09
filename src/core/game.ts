/* The game engine. Every player action is a serialisable command; dispatch() applies it, advances time
   through one pipeline (command → minutes pass → survival → statuses → events → autosave by the caller)
   and returns what happened for the UI and renderer to show. No Three.js, no DOM. */
import { Level1 } from "../world/level1";
import type { ActiveWorld } from "../world/world";
import { advanceWarehouse } from "../systems/encounters";
import { warehouseCommand } from "./level1";
import { meetElder, hearElder, elderChoiceVisible } from "../systems/elder";
import { queueReward, warehouseSurvival } from "../systems/rewards";
import type { ContentData } from "../../tools/content-schema";
import { draw, pick, type RngState, type Stream } from "./rng";
import { ck, DV, sstep, T, type Dir, type Text } from "./types";
import { Level0 } from "../world/level0";
import { edgeCells, edgeKey, passable, isOpenDoor, type Bottle, type GroundItem, type AnyZone, type Level0World } from "../world/types";
import { newHallucinations, newRoomPersonRun, newLevel1Hazards, SAVE_VERSION, type MapKey, type MapMark, type Meta, type RunState } from "../state/types";
import { addStatus, clearStatus, tick, H, type Activity, type Env } from "../systems/survival";
import { notebookReadBlock, notebookReadGain, recordNotebook, recordNotebookDoor, setMapMark } from "../systems/notebook";
import { HALLUC_ONSET, perceive, perceiveWarehouse } from "../systems/hallucinations";
import { makePack, matchesPack, validCode } from "../systems/symbol-lock";
import { hasTorch } from "../systems/lighting";
import { personChoiceVisible, personReady, planRoomPerson, sealedGreyWater } from "../systems/room-person";

export const CARRY = 8;                 // weight you can carry
export const PREP_CARRY = 5;            // weight you can bring into a run
export const EVENT_GAP = 90;           // game minutes after any Level 0 event before the next can fire

export type Command =
  | { type: "move"; d: Dir } | { type: "turn"; dir: -1 | 1 | 2 } | { type: "search" } | { type: "rest"; hours: number }
  | { type: "pickup"; key: string } | { type: "drop"; key: string }
  | { type: "drink"; key: string; sip?: boolean } | { type: "eat"; key: string } | { type: "inspect"; key: string }
  | { type: "boil"; salt: string; target: string } | { type: "bandage"; key: string }
  | { type: "door"; edge: string } | { type: "touch"; edge: string } | { type: "flicker"; edge: string }
  | { type: "pit"; jump: boolean } | { type: "ceiling" } | { type: "salt" } | { type: "wring"; into?: string }
  | { type: "examine"; what: "tally" | "peel" | "notes" }
  | { type: "choose"; index: number }
  | { type: "cabinetTake"; key: string } | { type: "cabinetPut"; key: string } | { type: "writeNote"; text: string }
  | { type: "readGuide" } | { type: "readSign" } | { type: "baseSupplies" }
  | { type: "elderTalk" } | { type: "elderChoice"; id: string } | { type: "readNotice" }
  | { type: "crateExamine"; id: string } | { type: "crateOpen"; id: string } | { type: "crateTake"; id: string; key: string }
  | { type: "corpse" } | { type: "toggleFlashlight" } | { type: "avoidEntity" } | { type: "wait" }
  | { type: "packExamine" } | { type: "packMarks" } | { type: "packAttempt"; code: number[] }
  | { type: "packUnjam" } | { type: "packForce" } | { type: "packTake"; key: string }
  | { type: "roomPersonTalk" } | { type: "roomPersonChoice"; id: string; waterKey?: string }
  | { type: "mapMark"; key: MapKey; mark: MapMark | null } | { type: "rereadNotebook" };

export type Anim = { kind: "move"; d: Dir; from: { i: number; j: number; d: Dir } } | { kind: "turn"; dir: -1 | 1 | 2; from: { i: number; j: number; d: Dir } } | { kind: "door"; edge: string } | { kind: "none" };
export interface Outcome { say: Text[]; caption?: Text; captionVisual?: boolean; interrupted?: boolean; perceivedTime?: Text; anim: Anim; event?: string; ended?: boolean; levelChanged?: boolean; rebuild?: boolean; important?: boolean; sfx: string[]; minutes: number }

const COLOR_NAME: Record<string, Text> = { grey: T("灰色", "grey"), green: T("綠色", "green"), blue: T("藍色", "blue"), reddish: T("偏紅的", "reddish") };

export class Game {
  run: RunState; meta: Meta; world: ActiveWorld; c: ContentData;
  private out!: Outcome;
  get level0(): Level0World {
    if (this.world.level !== "level-0") throw new Error("Level 0 capability used outside Level 0");
    return this.world;
  }

  constructor(c: ContentData, meta: Meta, run: RunState) {
    this.c = c; this.meta = meta; this.run = run;
    if (run.level === "level-1") {
      if (!("crates" in run.world) || !run.l1) throw new Error("Missing Level 1 save data");
      this.world = new Level1(run.seed, c.levels[0], run.world);
      this.world.ensureAround(run.pos.i, run.pos.j);
      return;
    }
    if ("crates" in run.world) throw new Error("Level 0 save contains warehouse data");
    this.world = new Level0(run.seed, run.world.cells.length ? run.world : undefined);
    if (!run.world.cells.length) {
      this.world.ensureAround(0, 0);
      this.placeCorpse();
    }
  }

  /* ---------- new run ---------- */
  static newRun(c: ContentData, meta: Meta, seed: number, bought: string[]): Game {
    meta.runs += 1;
    const rng: RngState = { seed, counters: { halluc: 0, puzzles: 0, quests: 0 } };
    const run: RunState = {
      v: SAVE_VERSION, level: "level-0", seed, run: meta.runs, time: 0, clock0: Math.floor((seed % 1440 + 1440) % 1440),
      stats: { water: 68, food: 70, awake: 60, sanity: 82, wretched: 0, health: 100 }, status: {},
      inv: bought.map((id, k) => ({ key: "start" + k, id })), carried: [...bought],
      pos: { i: 0, j: 0, d: 0 }, rng, world: { seed, manila: [0, 0], cells: [], edges: [], fixed: [], picked: [], opened: [], flickerKey: null, fakeKey: null, corpse: null },
      map: {}, mapMarks: {}, lastNotebookRead: null,
      mapPages: [], l1: null, flashlightOn: true, npcSeenThisRun: [], pendingRewards: [],
      fakePiano: null, halluc: newHallucinations(),
      packPlan: "none", lockedPack: null,
      roomPerson: newRoomPersonRun(),
      moves: 0, shifted: 0, outageLeft: 0, lastOutage: -99, redStage: 0, eventsDone: [], eventLast: {}, pendingEvent: null, found: [], log: [], manilaTaken: 0, ended: null
    };
    const g = new Game(c, meta, run);
    run.roomPerson = planRoomPerson(g.personQuest, meta, () => g.rand("quests"));
    const topUp = meta.cabinet.filter(x => x.id === "almond_water").length < 2;
    if (run.roomPerson.variant === "first") {
      // Move only this run's volunteer bottle. Never remove any stored item.
      const q = g.personQuest, p = c.puzzles.find(p => p.id === q.pack.puzzle)!;
      run.lockedPack = makePack(p, run, meta, { i: g.level0.manila[0], j: g.level0.manila[1] }, () => g.rand("puzzles"));
      run.lockedPack.story = "room_person";
      run.lockedPack.items = Array.from({ length: q.pack.extraWater }, (_, k) => ({ key: `pack:${run.run}:${k}`, id: "almond_water" }));
      if (topUp) run.lockedPack.items.push({ key: "vol" + meta.runs, id: "almond_water" });   // returned to the cabinet at the end if left in the pack
    } else {
      if (topUp) meta.cabinet.push({ key: "vol" + meta.runs, id: "almond_water" });
      const p = g.packPuzzle;
      if (run.run >= p.spawn.minRun && g.rand("puzzles") < p.spawn.chance) run.packPlan = "arch";
    }
    recordNotebook(run, g.world, true);
    run.log.push({ t: T(`你在嗡嗡聲裡醒來。這是你記得的第 ${meta.runs} 次。`, `You wake up in the hum. This is the ${ordinal(meta.runs)} time you remember.`) });
    return g;
  }
  private placeCorpse() {
    if (!this.meta.corpses[this.run.level]) return;
    if (this.world.level === "level-1") {
      this.world.corpse = this.world.global(-3, 1); return;
    }
    for (let k = 0; k < 60; k++) {
      const a = this.world.hash(k, 71) * Math.PI * 2, r = 4 + this.world.hash(k, 72) * 8, i = Math.round(Math.cos(a) * r), j = Math.round(Math.sin(a) * r);
      if (this.world.zone(i, j) === "hall" && !(i === 0 && j === 0)) { this.world.corpse = [i, j]; return; }
    }
  }
  save(): RunState { this.run.world = this.world.toData(); return this.run; }

  /* ---------- helpers ---------- */
  item(id: string) { return this.c.items.find(x => x.id === id)!; }
  liquid(id: string) { return this.c.liquids.find(x => x.id === id)!; }
  zoneHere(): AnyZone { return this.world.zone(this.run.pos.i, this.run.pos.j); }
  cellHere() { return this.world.cells.get(ck(this.run.pos.i, this.run.pos.j))!; }
  has(id: string) { return this.run.inv.some(x => x.id === id); }
  weight() { return this.run.inv.reduce((s, x) => s + this.item(x.id).weight, 0); }
  itemName(x: { id: string; bottle?: Bottle }): Text {
    if (x.bottle) { const b = x.bottle, cn = COLOR_NAME[b.color]; if (b.liquid === "empty") return T(`空的${cn.zh}保溫瓶`, `Empty ${cn.en} flask`); return T(`${cn.zh}保溫瓶${b.boiled ? "（煮過）" : ""}`, `${cap(cn.en)} flask${b.boiled ? " (boiled)" : ""}`); }
    return this.item(x.id).name;
  }
  bottleLook(b: Bottle): Text {
    if (b.liquid === "empty") return T("裡面是空的。", "It is empty.");
    const l = this.liquid(b.liquid).look;
    const fill = b.full ? (b.sealed ? T("封口完好，裝得滿滿的", "sealed and full") : T("裝滿了，但封口被打開過", "full, but the seal has been broken")) : T("沒有裝滿，搖起來只剩一半", "not full; it sloshes half-empty");
    return T(`液體${l.zh}。${fill.zh}。`, `The liquid is ${l.en.toLowerCase()}; ${fill.en}.`);
  }
  hasLight() { return hasTorch(this.run); }
  powerOut() { return this.world.level === "level-1" ? this.zoneHere() !== "alpha" && this.run.l1?.power.phase === "blackout" : this.run.outageLeft > 0; }
  isDark() { return this.zoneHere() === "dark" || this.powerOut(); }
  env(): Env {
    const { i, j } = this.run.pos;
    if (this.world.level === "level-1") {
      const z = this.zoneHere(), dark = this.isDark() && !this.hasLight(), rates = this.world.rules.survival;
      return { zone: z, dark, redK: 0, manilaK: 0, inLevel0: false,
        sanityRate: dark ? rates.darkSanity : rates.sanity, shelterRecovery: z === "alpha" ? rates.baseSanity : undefined };
    }
    return { zone: this.zoneHere(), dark: this.isDark(), redK: 1 - sstep(.8, 3.2, this.level0.redDist(i, j)), manilaK: this.zoneHere() === "manila" ? 1 : 0, inLevel0: true };
  }
  private say(t: Text, kind?: "event" | "warn" | "caption") { this.out.say.push(t); this.run.log.push({ t, kind }); if (this.run.log.length > 60) this.run.log.splice(0, this.run.log.length - 60); }
  private rand(s: Stream = "misc") { return draw(this.run.rng, s); }
  private discover(id: string) { if (!this.meta.discoveries.includes(id) && !this.run.found.includes(id)) this.run.found.push(id); }
  learn(id: string) { if (!this.meta.clues.includes(id)) this.meta.clues.push(id); }
  get packPuzzle() { return this.c.puzzles.find(p => p.id === (this.run.lockedPack?.id ?? "fallen_pack"))!; }
  canReachPack() {
    const p = this.run.lockedPack?.pos, r = this.run.pos;
    return this.run.level === "level-0" && !!p && ((p.i === r.i && p.j === r.j) || (this.world.level === "level-0" && this.world.inManila(p.i, p.j) && this.zoneHere() === "manila"));
  }
  get personQuest() { return this.c.quests.find(q => q.id === "room_person")!; }
  get personDialogue() { return this.c.dialogue.find(d => d.id === this.personQuest.dialogue)!; }
  get packPaper() { return this.run.lockedPack?.story === "room_person" ? this.personQuest.text.packPaper : this.packPuzzle.text.paper; }
  get packInside() { return this.run.lockedPack?.story === "room_person" ? this.personQuest.text.packInside : this.packPuzzle.text.inside; }
  canTalkToPerson() { return this.zoneHere() === "manila" && this.run.roomPerson.entered && this.run.roomPerson.present; }
  personWater() { return this.run.inv.filter(sealedGreyWater); }
  personChoices() { return this.personDialogue.choices.filter(ch => personChoiceVisible(ch, this.run.roomPerson)).map(ch => ({ ch, ok: !ch.requires?.water || this.personWater().length > 0 })); }

  /** Pass time; may end the run. */
  private pass(minutes: number, act: Activity = "idle"): boolean {
    if (this.world.level === "level-1") {
      const completed = advanceWarehouse(this.run, this.world, this.c.hazards[0], minutes, act, {
        rand: () => this.rand("level1"),
        tick: (m, activity) => { const before = this.run.time, death = tick(this.run, m, activity, this.env());
          this.out.minutes += this.run.time - before; if (death) this.end(death); return !death; },
        say: t => this.say(t, "warn"),
        signal: (t, sound, visual) => { this.out.caption = t; this.out.captionVisual = visual; this.out.important = true; this.out.rebuild = true; if (sound) this.out.sfx.push(sound); }
      });
      if (!completed) this.out.interrupted = true;
      return completed;
    }
    this.out.minutes += minutes;
    const death = tick(this.run, minutes, act, this.env()); if (death) this.end(death);
    return !death;
  }
  private resolveThreat(cmd: Command): boolean {
    if (this.world.level !== "level-1" || !this.run.l1?.encounter) return cmd.type === "avoidEntity";
    const r = this.run, l = r.l1!, e = l.encounter!, t = this.c.hazards[0].text;
    const back = cmd.type === "move" && !this.hasLight() && r.pos.i + DV[cmd.d][0] === e.retreat.i && r.pos.j + DV[cmd.d][1] === e.retreat.j;
    if (cmd.type === "avoidEntity" || back) {
      r.flashlightOn = false; l.encounter = null; l.hazards.avoided++;
      r.pos = { ...e.retreat, d: r.pos.d }; this.world.ensureAround(r.pos.i, r.pos.j);
      this.pass(5); if (!r.ended) this.say(t.retreat); this.out.rebuild = true; this.out.important = true;
      recordNotebook(r, this.world, true); return true;
    }
    if (["mapMark", "readGuide", "readSign", "drop"].includes(cmd.type) || (cmd.type === "toggleFlashlight" && r.flashlightOn)) return false;
    this.pass(1); if (r.ended) return true;
    this.out.important = true; this.out.interrupted = true; this.out.captionVisual = true; this.out.rebuild = true;
    if (e.phase === "noticed") { e.phase = "approaching"; this.say(t.approaching, "warn"); this.out.caption = this.hasLight() ? t.litCaption : t.darkCaption; }
    else {
      l.encounter = null; l.hazards.hits++; r.stats.health = Math.max(0, r.stats.health - this.c.hazards[0].encounter.damage);
      addStatus(r, "bleeding", this.c.hazards[0].encounter.bleedingHours); this.say(t.hurt, "warn");
      if (r.stats.health <= 0) this.end("death_smiler");
      else { r.pos = { ...e.retreat, d: r.pos.d }; this.world.ensureAround(r.pos.i, r.pos.j); recordNotebook(r, this.world, true); }
    }
    return true;
  }

  /* ---------- dispatch ---------- */
  dispatch(cmd: Command): Outcome {
    this.out = { say: [], anim: { kind: "none" }, sfx: [], minutes: 0 };
    const r = this.run;
    if (r.ended) return this.out;
    if (r.pendingEvent && cmd.type !== "choose") return this.out;
    if (this.resolveThreat(cmd)) return this.out;
    const from = { ...r.pos }, hadNotebook = this.has("notebook"), previousSanity = r.stats.sanity, redStage = r.redStage;
    const handled = this.world.level === "level-1" && warehouseCommand({ run: r, world: this.world, content: this.c, out: this.out,
      say: (t, kind) => this.say(t, kind), pass: (m, a) => this.pass(m, a), rand: () => this.rand(),
      discover: id => this.discover(id), knows: id => this.meta.clues.includes(id), learn: id => this.learn(id), weight: () => this.weight(), meetElder: () => this.meetAlphaElder() }, cmd);
    if (!handled) switch (cmd.type) {
      case "move": this.move(cmd.d); break;
      case "turn": this.turn(cmd.dir); break;
      case "search": this.search(); break;
      case "rest": this.rest(cmd.hours); break;
      case "pickup": this.pickup(cmd.key); break;
      case "drop": this.drop(cmd.key); break;
      case "drink": this.drink(cmd.key, !!cmd.sip); break;
      case "eat": this.eat(cmd.key); break;
      case "inspect": this.inspect(cmd.key); break;
      case "boil": this.boil(cmd.salt, cmd.target); break;
      case "bandage": this.bandage(cmd.key); break;
      case "door": this.door(cmd.edge); break;
      case "touch": this.touch(cmd.edge); break;
      case "flicker": this.flicker(cmd.edge); break;
      case "pit": this.pit(cmd.jump); break;
      case "ceiling": this.ceiling(); break;
      case "salt": this.salt(); break;
      case "wring": this.wring(cmd.into); break;
      case "examine": this.examine(cmd.what); break;
      case "choose": this.choose(cmd.index); break;
      case "cabinetTake": this.cabinetTake(cmd.key); break;
      case "cabinetPut": this.cabinetPut(cmd.key); break;
      case "writeNote": this.writeNote(cmd.text); break;
      case "corpse": this.searchCorpse(); break;
      case "toggleFlashlight":
        if (!this.has("flashlight")) break;
        r.flashlightOn = !r.flashlightOn; this.pass(1);
        this.say(r.flashlightOn ? T("你打開了手電筒。", "You switch on the flashlight.") : T("你關掉了手電筒。", "You switch off the flashlight."));
        break;
      case "packExamine": this.packExamine(); break;
      case "packMarks": this.packMarks(); break;
      case "packAttempt": this.packAttempt(cmd.code); break;
      case "packUnjam": this.packUnjam(); break;
      case "packForce": this.packForce(); break;
      case "packTake": this.packTake(cmd.key); break;
      case "roomPersonTalk": this.roomPersonTalk(); break;
      case "roomPersonChoice": this.roomPersonChoice(cmd.id, cmd.waterKey); break;
      case "mapMark": setMapMark(r, cmd.key, cmd.mark); break;
      case "rereadNotebook": this.rereadNotebook(); break;
      case "elderTalk":
        if (this.zoneHere() === "alpha") { this.meetAlphaElder(); this.say(this.elder.text.next); this.out.important = true; } break;
      case "elderChoice":
        if (this.zoneHere() === "alpha") { for (const t of hearElder(r, this.meta, this.elder, cmd.id)) this.say(t); this.out.important = true; } break;
      case "readNotice":
        if (this.zoneHere() === "alpha") { this.say(this.elder.text.supplies); this.say(this.supplyNotice()); this.out.important = true; } break;
    }
    if (!r.ended && cmd.type !== "mapMark" && cmd.type !== "rereadNotebook") {
      const entered = from.i !== r.pos.i || from.j !== r.pos.j || !hadNotebook;
      if (recordNotebook(r, this.world, entered)) this.say(T("這裡跟你畫的不一樣。", "This isn't what you drew."));
      if (cmd.type === "door" && this.out.anim.kind === "door") recordNotebookDoor(r, this.world, cmd.edge);
    }
    if (!r.ended && this.out.minutes > 0 && this.world.level === "level-0") {
      const z = this.zoneHere();
      const perception = perceive(r, this.world, {
        action: cmd.type === "move" && this.out.anim.kind === "move" ? "move" : cmd.type === "search" || cmd.type === "rest" ? cmd.type : null,
        minutes: this.out.minutes, previousSanity,
        important: !!this.out.important || !!this.out.caption || !!r.pendingEvent || !!this.world.flickerKey || redStage !== r.redStage || z === "pit" || z === "red" || this.world.redDist(r.pos.i, r.pos.j) <= 3.2
      }, () => this.rand("halluc"));
      for (const line of perception.say) this.say(line);
      if (perception.caption) this.out.caption = perception.caption;
      if (perception.sfx) this.out.sfx.push(perception.sfx);
      if (perception.perceivedTime) this.out.perceivedTime = perception.perceivedTime;
    }
    if (!r.ended && r.level === "level-1" && this.out.minutes > 0) {
      const p = perceiveWarehouse(r, { action: cmd.type === "move" || cmd.type === "search" || cmd.type === "rest" ? cmd.type : null,
        minutes: this.out.minutes, previousSanity, important: !!this.out.important || !!this.out.caption }, this.zoneHere() === "alpha", () => this.rand("halluc"));
      for (const t of p.say) this.say(t);
      if (p.perceivedTime) this.out.perceivedTime = p.perceivedTime;
    }
    return this.out;
  }

  /* ---------- movement ---------- */
  private move(d: Dir) {
    const r = this.run, w = this.level0, { i, j } = r.pos;
    if (!passable(w.edgeAt(i, j, d))) return;
    const from = { ...r.pos }, ni = i + DV[d][0], nj = j + DV[d][1], zonePrev = this.zoneHere();
    r.pos = { i: ni, j: nj, d }; r.moves++;
    w.ensureAround(ni, nj);
    this.out.anim = { kind: "move", d, from }; this.out.rebuild = true;
    const z = this.zoneHere();
    let mins = 10 + Math.floor(this.rand() * 7);
    if (z === "arch") mins += 5;                                 // the deep carpet
    if (this.isDark() && !this.hasLight()) mins += 8;            // feeling your way in the dark
    this.pass(mins, "walk"); if (r.ended) return;
    if (z === "red") return this.end("closed_loop");
    this.zoneNarration(zonePrev, z);
    if (zonePrev !== "manila" && z === "manila") this.enterRoomPerson();
    if (zonePrev === "manila" && z !== "manila" && r.roomPerson.present && r.roomPerson.entered) this.separateRoomPerson(false);
    this.redSigns();
    if (z === "pit" && (r.stats.awake > 24 * H || r.stats.water < 15) && this.rand("events") < .06) {
      this.say(T("你的腳步一軟，踩空了——", "Your step falters and finds nothing—"), "warn");
      return this.fall();
    }
    if (w.corpse && w.corpse[0] === ni && w.corpse[1] === nj) this.say(T("地上躺著一個人。一動也不動。", "Someone is lying on the floor. Not moving."), "warn");
    this.outage(z);
    this.afterStep([from, r.pos]);
    this.maybeEvent("move", z);
    if (r.packPlan === "arch" && !r.lockedPack && r.moves >= this.packPuzzle.spawn.minMoves && z === "arch") {
      const site = w.unseenArchSite([from, r.pos]);
      if (site) { r.lockedPack = makePack(this.packPuzzle, r, this.meta, site, () => this.rand("puzzles")); r.packPlan = "none"; this.out.rebuild = true; }
    }
  }
  private turn(dir: -1 | 1 | 2) {
    const r = this.run, from = { ...r.pos };
    r.pos = { ...r.pos, d: ((r.pos.d + dir + 4) % 4) as Dir };
    this.out.anim = { kind: "turn", dir, from };
    this.pass(1);
    // looking back always shifts what was behind you; a side turn sometimes does
    if (dir === 2 || this.rand("shift") < .35) {
      const n = this.level0.shiftUnseen(this.level0.visibleFrom([from, r.pos]));
      r.shifted += n; if (n) this.out.rebuild = true;
      if (dir === 2) this.say(this.level0.stable(r.pos.i, r.pos.j) && !n ? T("你回頭看。這裡沒有變，跟剛才一模一樣。", "You look back. Nothing here has changed.") : n ? T("你回頭看。剛才走過的路……不一樣了。", "You look back. The way you came... is not the same.") : T("你回頭看。", "You look back."));
    }
  }
  private afterStep(poses: { i: number; j: number; d: Dir }[]) {
    const r = this.run, w = this.level0;
    if (this.rand("shift") < .35) { const n = w.shiftUnseen(w.visibleFrom(poses)); r.shifted += n; if (n) this.out.rebuild = true; }
    // the flickering wall: only after you have lasted long enough, more likely the longer you stay
    const hours = r.time / H;
    if (w.flickerKey) {
      const [[a, b]] = edgeCells(w.flickerKey);
      if (Math.hypot(a - r.pos.i, b - r.pos.j) > 6) { w.edges.set(w.flickerKey, "wall"); w.flickerKey = null; }   // walk away and it is gone
    }
    if (!w.flickerKey && hours >= 30 && this.rand("events") < Math.min(.05, .008 + (hours - 30) * .0015)) {
      const k = w.wallAhead(r.pos.i, r.pos.j, r.pos.d);
      if (k) { w.edges.set(k, "flicker"); w.flickerKey = k; this.out.rebuild = true; this.say(T("走廊盡頭的牆在閃。不是燈在閃，是牆本身。", "The wall at the end of the corridor flickers. Not the lights: the wall itself."), "event"); this.discover("flicker_wall"); }
    }
    // when your mind frays, your eyes invent one
    if (!w.fakeKey && r.stats.sanity < HALLUC_ONSET && this.rand("events") < .08) {
      const k = w.wallAhead(r.pos.i, r.pos.j, r.pos.d);
      if (k && k !== w.flickerKey) { w.edges.set(k, "fakeflicker"); w.fakeKey = k; this.out.rebuild = true; this.say(T("走廊盡頭的牆在閃。", "The wall at the end of the corridor flickers."), "event"); }
    }
  }
  private zoneNarration(prev: AnyZone, z: AnyZone) {
    if (z === prev) return;
    const lit = this.hasLight();
    const M: Partial<Record<AnyZone, Text>> = {
      arch: T("牆變成了淡色，開著一個個拱門。地毯深得會陷進去。這種地方據說不會偏移。", "The walls turn pale, opened by arch after arch. The carpet is deep enough to sink into. Places like this are said not to shift."),
      pillar: T("一大片柱子，整齊得像格子一樣，一直排到看不見的地方。", "A field of pillars in a perfect grid, running out of sight."),
      dark: lit ? T("燈全滅了。地上積著到腳踝的水。你打開了手電筒。", "Every light is out. Ankle-deep water on the floor. You switch on the flashlight.") : T("燈全滅了。地上積著到腳踝的水。你什麼都看不清楚，只能摸著牆走。", "Every light is out. Ankle-deep water on the floor. You can barely see; you feel your way along the wall."),
      pit: T("地上開始出現坑洞，一個一個排成格子。最好別靠太近。", "Holes begin to appear in the floor, set out in a grid. Better not get too close."),
      manila: T("牛皮紙色的壁紙，木頭地板，房間正中間有一張八角桌和兩張椅子。嗡嗡聲停了。遠遠的有人在彈鋼琴，但是房間裡沒有鋼琴。", "Manila wallpaper, a wooden floor, an octagonal table and two chairs in the middle. The hum has stopped. Somewhere far off someone is playing piano, but there is no piano here."),
      hall: prev === "dark" ? T("嗡嗡聲回來了。你從來沒想過會想念它。", "The hum is back. You never thought you would miss it.") : T("又是黃色的走廊。嗡嗡聲沒有停過。", "Yellow corridors again. The hum never stops.")
    };
    if (prev === "manila") return this.say(T("你走出房間，嗡嗡聲一下子全部湧了回來。", "You step out and the hum floods back all at once."));
    const t = M[z]; if (t) this.say(t);
    if (z !== "hall") this.discover("zone_" + z);
    if (z === "manila") this.discover("manila");
  }
  private redSigns() {
    const r = this.run, rd = this.level0.redDist(r.pos.i, r.pos.j);
    if (rd <= 1.01 && r.redStage < 2) { r.redStage = 2; this.say(T("前面那個房間整個是紅色的。牆、地毯、燈光，全都是。你的腳不太想停下來。", "The room ahead is entirely red. Walls, carpet, light. Your feet don't quite want to stop."), "warn"); this.learn("red_room_signs"); this.discover("red_signs"); }
    else if (rd <= 2.3 && r.redStage < 1) { r.redStage = 1; this.say(T("地毯黏黏的，每走一步鞋底都被輕輕扯住。燈光好像偏紅了一點。空氣裡有一點鐵鏽的味道。", "The carpet is tacky; each step it tugs at your soles. The light seems a little redder. A faint smell of rust."), "warn"); }
    else if (rd > 3.5) r.redStage = 0;
  }
  private outage(z: AnyZone) {
    const r = this.run;
    if (r.outageLeft > 0) {
      if (--r.outageLeft === 0) { this.say(T("燈管一根接一根亮了回來，嗡嗡聲也跟著回來了。你發現自己的手在發抖。", "The tubes come back one after another, and the hum with them. You notice your hands are shaking."), "event"); this.out.sfx.push("relight"); }
    } else if (r.moves >= 8 && r.moves - r.lastOutage > 14 && (z === "hall" || z === "pillar") && this.rand("events") < .05) {
      r.outageLeft = 3 + Math.floor(this.rand("events") * 3); r.lastOutage = r.moves;
      this.say(this.hasLight() ? T("啪的一聲，所有的燈同時熄滅了。嗡嗡聲停了下來，安靜得讓人耳鳴。你打開了手電筒。", "With a click every light goes out. The hum stops; the silence rings. You switch on the flashlight.") : T("啪的一聲，所有的燈同時熄滅了。嗡嗡聲停了下來。你什麼都看不見。", "With a click every light goes out. The hum stops. You can't see a thing."), "event");
      this.out.sfx.push("clunk");
    }
  }

  /* ---------- events ---------- */
  /** One roll per step: every eligible event gets its own share, so list order never starves later events. */
  private maybeEvent(on: "move" | "rest", z: AnyZone) {
    const r = this.run; if (r.ended || r.pendingEvent) return;
    const last = Math.max(-Infinity, ...Object.values(r.eventLast));
    if (r.time - last < EVENT_GAP) return;
    const times = (id: string) => r.eventsDone.filter(x => x === id).length;
    const ok = this.c.events.filter(e => {
      if (e.trigger.on !== on || !e.trigger.zones.includes(z as never)) return false;
      if (e.trigger.minHours && r.time / H < e.trigger.minHours) return false;
      const n = times(e.id);
      if ((e.once === "per_run" && n) || (e.maxPerRun && n >= e.maxPerRun)) return false;
      return !(e.id in r.eventLast) || r.time - r.eventLast[e.id] >= e.cooldown * H;
    });
    if (!ok.length) return;
    let u = this.rand("events");
    const e = ok.find(x => (u -= x.trigger.chance) < 0); if (!e) return;
    r.pendingEvent = e.id; r.eventsDone.push(e.id); r.eventLast[e.id] = r.time;
    this.say(this.eventText(e.id), "event"); if (e.caption) this.out.caption = e.caption;
    if (e.sfx) this.out.sfx.push(e.sfx);
    this.out.event = e.id;
  }
  /** The pending event's opening line: the `again` wording once it has already happened this run. */
  eventText(id: string): Text {
    const e = this.c.events.find(x => x.id === id)!;
    return e.again && this.run.eventsDone.filter(x => x === id).length > 1 ? e.again : e.text;
  }
  availableChoices(id: string) { const e = this.c.events.find(x => x.id === id)!; return e.choices.map(ch => ({ ch, ok: !ch.requires || this.has(ch.requires.item) })); }
  private choose(index: number) {
    const r = this.run, e = this.c.events.find(x => x.id === r.pendingEvent); if (!e) return;
    const ch = e.choices[index]; if (!ch || (ch.requires && !this.has(ch.requires.item))) return;
    r.pendingEvent = null; this.say(ch.result);
    this.apply(ch.effects ?? {});
  }
  private apply(fx: { water?: number; food?: number; sanity?: number; rest?: number; health?: number; wretched?: number; time?: number; status?: string[]; clearStatus?: string[] }) {
    const s = this.run.stats, cl = (x: number) => Math.max(0, Math.min(100, x));
    if (fx.water) s.water = cl(s.water + fx.water); if (fx.food) s.food = cl(s.food + fx.food);
    if (fx.sanity) s.sanity = cl(s.sanity + fx.sanity); if (fx.wretched) s.wretched = cl(s.wretched + fx.wretched);
    if (fx.rest) s.awake = Math.max(0, s.awake - fx.rest);
    if (fx.health) s.health = Math.max(0, Math.min(100, s.health + fx.health));
    for (const st of fx.status ?? []) addStatus(this.run, st, st === "hearing_damage" ? 24 : st === "bleeding" ? 4 : null);
    for (const st of fx.clearStatus ?? []) clearStatus(this.run, st);
    if (s.health <= 0) return this.end("death_injury");
    if (fx.time) this.pass(fx.time);
  }

  /* ---------- actions ---------- */
  private search() {
    const r = this.run, c = this.cellHere();
    this.pass(30); if (r.ended) return;
    if (this.isDark() && !this.hasLight()) return this.say(T("你在黑暗裡摸了很久，只摸到濕透的地毯。", "You grope around in the dark for a long time and find only soaked carpet."));
    if (c.searched) return this.say(T("這一帶你已經翻過了。", "You have already been over this area."));
    c.searched = true;
    if (this.rand("loot") < .08) {
      const id = weighted(this.rand("loot"), [["snack_bar", 30], ["bottle", 30], ["bandage", 15], ["firesalt", 6], ["earplugs", 6], ["flashlight", 4], ["crowbar", 2], ["notebook", 12]]);
      this.drop_(c.items, id, c.i, c.j, "s" + r.time);
      this.say(T(`你在牆角的地毯縫裡找到了東西：${this.itemName(c.items[c.items.length - 1]).zh}。`, `Wedged where the carpet meets the wall, you find something: ${this.itemName(c.items[c.items.length - 1]).en.toLowerCase()}.`));
      this.out.rebuild = true;
    } else this.say(pick(r.rng, "misc", [T("你沿著牆摸了一圈，什麼都沒有。", "You work your way along the walls. Nothing."), T("地毯底下只有更多的地毯。", "Under the carpet there is only more carpet."), T("你找了很久，只找到幾根不知道是誰的頭髮。", "You search for a long time and find only a few hairs. Whose, you can't tell.")]));
  }
  private drop_(list: GroundItem[], id: string, i: number, j: number, tag: string) {
    const key = `${ck(i, j)}:${tag}`;
    list.push({ key, id, bottle: id === "bottle" ? this.world.rollBottle(i, j, 0, Math.floor(this.rand("loot") * 1e6)) : undefined, x: (this.rand("loot") - .5) * 1.6, z: (this.rand("loot") - .5) * 1.6 });
  }
  private rest(hours: number) {
    const r = this.run, z = this.zoneHere(), safe = z === "arch" || z === "manila";
    const sleep = r.stats.awake > 6 * H;
    this.say(sleep ? T(`你${safe ? "靠著牆" : "蜷在地毯上"}睡了一覺。`, `You sleep ${safe ? "against the wall" : "curled up on the carpet"}.`) : T("你坐下來休息。睡不著。", "You sit down to rest. Sleep won't come."));
    this.pass(hours * H, sleep ? "sleep" : "idle"); if (r.ended) return;
    if (!safe) {                                     // everything you were not looking at changed while your eyes were closed
      const n = this.level0.shiftUnseen(new Set([ck(r.pos.i, r.pos.j)]), true); r.shifted += n; this.out.rebuild = true;
      if (n) this.say(T("醒來的時候，四周的走廊跟睡著前不一樣了。", "When you wake, the corridors around you are not the ones you fell asleep in."));
    } else this.say(T("醒來的時候，四周跟睡前一模一樣。", "When you wake, everything is exactly as it was."));
    if (r.outageLeft > 0) { r.outageLeft = 0; this.say(T("燈已經亮回來了。", "The lights are back on.")); }
    this.maybeEvent("rest", z);
  }
  private pickup(key: string) {
    const c = this.cellHere(), it = c.items.find(x => x.key === key); if (!it) return;
    if (this.weight() + this.item(it.id).weight > CARRY) return this.say(T("拿不動了。得先放下一些東西。", "You can't carry any more. Put something down first."));
    c.items = c.items.filter(x => x !== it); this.world.picked.add(key);
    this.run.inv.push({ key, id: it.id, bottle: it.bottle });
    this.say(it.bottle ? T(`你撿起${this.itemName(it).zh}。${this.bottleLook(it.bottle).zh}`, `You pick up the ${this.itemName(it).en.toLowerCase()}. ${this.bottleLook(it.bottle).en}`) : T(`你撿起了${this.itemName(it).zh}。`, `You pick up the ${this.itemName(it).en.toLowerCase()}.`));
    this.out.rebuild = true; this.pass(1);
  }
  private drop(key: string) {
    const r = this.run, x = r.inv.find(y => y.key === key); if (!x) return;
    r.inv = r.inv.filter(y => y !== x);
    const c = this.cellHere(); c.items.push({ key: x.key + ":d" + r.time, id: x.id, bottle: x.bottle, x: (this.rand() - .5) * 1.4, z: (this.rand() - .5) * 1.4 });
    this.say(T(`你放下了${this.itemName(x).zh}。`, `You put down the ${this.itemName(x).en.toLowerCase()}.`)); this.out.rebuild = true;
  }
  private take(key: string) { const r = this.run, x = r.inv.find(y => y.key === key); if (x) r.inv = r.inv.filter(y => y !== x); return x; }
  private drink(key: string, sip: boolean) {
    const r = this.run, x = r.inv.find(y => y.key === key); if (!x) return;
    if (x.id === "almond_water") {
      this.take(key); this.pass(2); if (r.level === "level-1" && r.ended) return; this.say(T("你喝完了那瓶杏仁水。微甜，杏仁的味道。身體裡有什麼東西鬆了下來。", "You finish the almond water. Slightly sweet, almonds. Something in you loosens.")); this.apply({ ...this.item("almond_water").effects, wretched: -6 }); return;
    }
    if (!x.bottle || x.bottle.liquid === "empty") return;
    const b = x.bottle, L = this.liquid(b.liquid);
    if (sip) {
      this.pass(2);
      if (!b.sealed && !b.full && b.spoiled && b.liquid !== "liquid_pain") this.say(T("一股霉味。你差點吐出來。", "A mouldy taste. You nearly retch."));
      else this.say(T(`你抿了一小口。${L.taste.zh}`, `You take a small sip. ${L.taste.en}`));
      b.sealed = false;
      if (L.sip) this.apply(L.sip);
      if (b.liquid === "liquid_pain") { this.learn("reddish_rule"); this.discover("liquid_pain"); }
      return;
    }
    const name = this.itemName(x); x.bottle = { ...b, liquid: "empty", full: false, sealed: false, spoiled: false, boiled: false };   // the flask stays with you
    this.pass(2); if (r.level === "level-1" && r.ended) return;
    this.say(T(`你把${name.zh}整瓶喝光。${L.taste.zh}`, `You drink the whole ${name.en.toLowerCase()}. ${L.taste.en}`));
    if (L.deadly) return this.end(L.deadly);
    const k = b.full ? 1 : .5;
    const fx = L.effects;
    this.apply({ water: (fx.water ?? 0) * k, food: (fx.food ?? 0) * k, sanity: fx.sanity, rest: fx.rest, health: fx.health, status: fx.status, clearStatus: fx.clearStatus, wretched: b.liquid.startsWith("aw_") ? -6 * k : 0 });
    if (b.spoiled && !b.boiled) { this.say(T("喝到最後有一股霉味。你的胃不太舒服。", "The last of it tastes of mould. Your stomach turns."), "warn"); addStatus(r, "infection", null); this.learn("unfilled_rule"); }
  }
  private eat(key: string) {
    const x = this.take(key); if (!x) return;
    this.pass(3); this.say(T(`你吃掉了${this.itemName(x).zh}。`, `You eat the ${this.itemName(x).en.toLowerCase()}.`));
    this.apply(this.item(x.id).effects ?? {});
  }
  private inspect(key: string) {
    const x = this.run.inv.find(y => y.key === key); if (!x) return;
    this.pass(5);
    if (x.bottle?.liquid === "empty") return this.say(T("空的保溫瓶。可以裝水。", "An empty flask. It could hold water."));
    if (x.bottle) {
      const b = x.bottle, L = this.liquid(b.liquid);
      this.say(T(`你把${this.itemName(x).zh}舉到燈下仔細看。${this.bottleLook(b).zh}${b.sealed ? "" : L.inspect.zh}`, `You hold the ${this.itemName(x).en.toLowerCase()} up to the light. ${this.bottleLook(b).en} ${b.sealed ? "" : L.inspect.en}`));
      if (b.sealed) this.say(T("封口還沒開，看不出更多。打開來就能聞、能看清楚。", "It is still sealed; you can't tell more. Opened, you could smell it and see it properly."));
      if (!b.full) this.learn("unfilled_rule");
      if (!b.sealed && b.color === "reddish") this.learn("reddish_rule");
    } else this.say(this.item(x.id).desc);
  }
  private boil(saltKey: string, target: string) {
    const r = this.run, b = r.inv.find(y => y.key === target)?.bottle; if (!b || b.liquid === "empty" || !r.inv.some(y => y.key === saltKey)) return;
    this.take(saltKey); const completed = this.pass(15); if (r.level === "level-1" && (!completed || r.ended)) return;
    b.boiled = true; b.sealed = false; b.spoiled = false; if (b.liquid === "carpet_water") b.liquid = "carpet_water_boiled";
    this.say(T("你把火鹽丟進瓶子裡。瓶身慢慢燙了起來，水滾了好一陣子。煮沸能殺菌——但去不掉別的東西。", "You drop the firesalt in. The flask grows hot and the water boils for a good while. Boiling kills germs, but it removes nothing else."));
    this.discover("firesalt");
  }
  private bandage(key: string) { if (!this.take(key)) return; this.pass(5); this.say(T("你把傷口包了起來。", "You bind the wound.")); this.apply(this.item("bandage").effects ?? {}); }
  private door(edge: string) {
    const r = this.run, w = this.level0, t = w.edges.get(edge); if (!t || isOpenDoor(t) || !t.startsWith("door")) return;
    const [[a, b], [c, d]] = edgeCells(edge);
    if (!((a === r.pos.i && b === r.pos.j) || (c === r.pos.i && d === r.pos.j))) return this.say(T("門在那邊，得先走過去。", "The door is over there. Get closer first."));
    if (t === "door-metal") {
      if (!this.has("crowbar")) { this.pass(1); this.out.sfx.push("rattle"); this.out.caption = T("〔門把喀喀作響，轉不動〕", "[The handle rattles but won't turn]"); return this.say(T("金屬門鎖住了。門把轉不動，門縫底下有一點涼涼的風。", "The metal door is locked. The handle won't turn; a cool draught comes from under it.")); }
      this.pass(15); this.say(T("你把撬棍卡進門縫，用全身的重量壓下去。鎖舌啪地一聲斷了。", "You wedge the crowbar into the gap and put your whole weight on it. The bolt snaps."));
    } else this.pass(1);
    w.opened.set(edge, swingAway(edge, r.pos.i, r.pos.j));
    w.edges.set(edge, (t + "-open") as never);
    this.out.anim = { kind: "door", edge }; this.out.sfx.push("creak"); this.out.caption = T("〔門軸吱呀作響〕", "[The hinges creak]");
    this.say(t === "door-manila" && this.zoneHere() !== "manila" ? T("門後是一個小房間，牛皮紙色的壁紙，木頭地板。嗡嗡聲……到門口就停了。", "Behind the door is a small room: manila wallpaper, a wooden floor. The hum... stops at the threshold.") : T("門開了。", "The door opens."));
  }
  private touch(edge: string) {
    const r = this.run, w = this.level0, t = w.edges.get(edge);
    const [[a, b], [c, d]] = edgeCells(edge);
    if (!((a === r.pos.i && b === r.pos.j) || (c === r.pos.i && d === r.pos.j))) return;
    this.pass(1);
    if (t === "wall" && w.yellower(edge) && !w.stable(a, b) && !w.stable(c, d)) return this.end("exit_level311");
    if (t === "fakeflicker") return this.flicker(edge);
    this.say(pick(r.rng, "misc", [T("壁紙摸起來有點潮濕。", "The wallpaper feels slightly damp."), T("牆是溫的，跟體溫差不多。", "The wall is warm, about body temperature."), T("你把耳朵貼上去。牆的另一邊也是嗡嗡聲。", "You press your ear to it. The other side hums too.")]));
  }
  private flicker(edge: string) {
    const r = this.run, w = this.level0, t = w.edges.get(edge);
    const near = edgeCells(edge).some(([a, b]) => Math.abs(a - r.pos.i) + Math.abs(b - r.pos.j) <= 3);
    if (!near) return this.say(T("太遠了。得走到牆前面。", "Too far. You need to reach the wall."));
    if (t === "flicker") { this.learn("flicker_wall"); return this.enterLevel1(); }
    if (t === "fakeflicker") {
      w.edges.set(edge, "wall"); w.fakeKey = null; this.out.rebuild = true;
      this.say(T("你整個人撲過去——撞上了一面普通的牆。牆從來沒有閃過。", "You throw yourself at it and hit an ordinary wall. It never flickered."), "warn");
      this.learn("flicker_wall"); this.apply({ health: -6, sanity: -6, time: 5 });
    }
  }
  private fall() { if (this.rand("events") < .4) this.end("exit_level72"); else this.end("no_one_returned"); }
  private pit(jump: boolean) {
    if (!this.cellHere().pits.length) return;
    if (!jump) { this.pass(2); this.say(T("你趴在坑邊往下看。光照不進去，看不到底。丟下去的東西沒有聲音。", "You lie at the edge and look down. Light doesn't reach in; you can't see a bottom. Nothing you drop makes a sound.")); this.discover("zone_pit"); return; }
    this.say(T("你深吸一口氣，跳了下去。", "You take a deep breath and jump."), "warn"); this.fall();
  }
  private ceiling() {
    const r = this.run, c = this.cellHere(); if (!c.hole) return;
    if (c.searched) return this.say(T("天花板裡你已經摸過了。", "You have already been through this ceiling."));
    const bar = this.has("crowbar");
    this.pass(bar ? 10 : 40); if (r.ended) return;
    c.searched = true;
    if (!bar && this.rand("loot") < .35) { addStatus(r, "bleeding", 4); this.say(T("你徒手把旁邊的板子扳開，邊緣把手掌割開了一道口子。", "You wrench the next panel loose by hand and its edge slices your palm."), "warn"); }
    if (this.rand("loot") < .3) {
      const id = weighted(this.rand("loot"), [["bottle", 35], ["snack_bar", 25], ["flashlight", 12], ["crowbar", 10], ["bandage", 10], ["watch", 8], ["notebook", 10]]);
      this.drop_(c.items, id, c.i, c.j, "c" + r.time);
      this.say(T(`天花板夾層裡有東西掉了下來：${this.itemName(c.items[c.items.length - 1]).zh}。`, `Something drops out of the ceiling void: ${this.itemName(c.items[c.items.length - 1]).en.toLowerCase()}.`));
      this.discover("ceiling_stash"); this.out.rebuild = true;
    } else this.say(T("夾層裡只有灰塵和一團一團的電線。", "Only dust and tangles of wiring up there."));
  }
  private salt() {
    const c = this.cellHere(); if (!c.salt) return;
    if (this.weight() + .2 > CARRY) return this.say(T("拿不動了。", "You can't carry any more."));
    c.salt = false; this.pass(10);
    this.run.inv.push({ key: "salt" + this.run.time, id: "firesalt" });
    this.say(T("你從牆角刮下一小撮白色結晶。指尖有一點溫溫的。", "You scrape a pinch of white crystals from the corner. Your fingertips feel faintly warm."));
    this.discover("firesalt"); this.out.rebuild = true;
  }
  canWring() { const z = this.zoneHere(); return this.run.level === "level-0" && z !== "manila" && z !== "red"; }
  private wring(into?: string) {
    if (!this.canWring()) return;
    const r = this.run; this.pass(15); if (r.ended) return;
    const empty = into ? r.inv.find(y => y.key === into && y.bottle?.liquid === "empty") : undefined;
    if (empty?.bottle) {
      empty.bottle = { liquid: "carpet_water", color: "grey", full: true, sealed: false, spoiled: true };
      this.say(T("你跪下來把地毯裡的水一點一點擠進瓶子裡。水是混濁的黃褐色，有霉味。", "You kneel and wring the carpet into the flask bit by bit. The water is murky yellow-brown and smells of mould."));
    } else {
      this.say(T("你跪下來，把地毯擠出來的水直接接在手裡喝。鹹鹹的，帶著霉味。", "You kneel and drink what you wring from the carpet straight from your hands. Salty and mouldy."), "warn");
      this.apply({ water: 8, health: -3 }); if (this.rand("loot") < .5) addStatus(r, "infection", null);
    }
  }
  private examine(what: "tally" | "peel" | "notes") {
    this.pass(2);
    if (this.run.ended) return;
    if (what === "tally") { this.learn("tally_marks"); this.say(this.c.clues.find(x => x.id === "tally_marks")!.text); this.discover("tally_marks"); }
    if (what === "peel") this.say(T("壁紙剝落了一角，翻起來的邊緣摸起來是濕的。底下不是牆，是一層深紅色的東西。", "A corner of wallpaper has peeled away; the curled edge is wet. Underneath is not wall but something deep red."));
    if (what === "notes") { this.learn("manila_guide"); this.learn("manila_hand"); this.learn("reddish_rule"); this.learn("flicker_wall"); if (this.zoneHere() === "manila") this.readPersonPaper(); }
  }
  private cabinetTake(key: string) {
    const m = this.meta, x = m.cabinet.find(y => y.key === key); if (!x || this.zoneHere() !== "manila") return;
    if (this.weight() + this.item(x.id).weight > CARRY) return this.say(T("拿不動了。", "You can't carry any more."));
    m.cabinet = m.cabinet.filter(y => y !== x); this.run.inv.push(x); this.run.manilaTaken++; this.pass(1);
    this.say(T(`你從櫃子裡拿出${this.itemName(x).zh}。`, `You take the ${this.itemName(x).en.toLowerCase()} from the cabinet.`));
  }
  private cabinetPut(key: string) {
    const x = this.take(key); if (!x || this.zoneHere() !== "manila") { if (x) this.run.inv.push(x); return; }
    this.meta.cabinet.push(x); this.pass(1);
    this.say(T(`你把${this.itemName(x).zh}放進櫃子裡，留給下一個人。`, `You leave the ${this.itemName(x).en.toLowerCase()} in the cabinet for the next one.`));
    if (!this.run.ended && this.run.roomPerson.returned && sealedGreyWater(x) && !this.meta.roomPerson.flags.returnedWater) {
      this.meta.roomPerson.flags.returnedWater = true; this.learn(this.personQuest.clues.returned); this.say(this.personQuest.text.leftWater); this.out.important = true;
    }
  }
  private writeNote(text: string) {
    const t = text.trim().slice(0, 200); if (!t || this.zoneHere() !== "manila") return;
    this.meta.notes.push({ t, run: this.run.run }); if (this.meta.notes.length > 12) this.meta.notes.shift();
    this.pass(5); this.say(T("你把紙條壓在桌上那疊筆記的最下面。下一次來的時候，它應該還在。", "You slip the note under the pile on the table. Next time, it should still be here."));
  }
  private searchCorpse() {
    const r = this.run, w = this.world, cp = this.meta.corpses[this.run.level];
    if (!cp || !w.corpse || w.corpse[0] !== r.pos.i || w.corpse[1] !== r.pos.j) return;
    const completed = this.pass(10); if (r.level === "level-1" && (!completed || r.ended)) return;
    this.say(r.level === "level-1" ? T("水泥柱旁躺著一具遺體。外套的袖口，跟你身上的一樣。", "A body lies beside the concrete pillar. The coat has the same cuffs as yours.") : T("你蹲下來。那個人的衣服……跟你身上穿的一模一樣。臉朝著地毯，你沒有把它翻過來。", "You crouch down. Their clothes are exactly the same as yours. The face is pressed into the carpet. You don't turn it over."), "warn");
    this.say(T(`口袋裡有一張紙條：「${cp.note.zh}」`, `In a pocket, a note: "${cp.note.en}"`));
    let got = 0;
    for (const x of cp.items) if (this.rand("body") < .6 && this.weight() + this.item(x.id).weight <= CARRY) { r.inv.push({ ...x, key: "body" + got + ":" + r.time }); got++; this.say(T(`你拿走了${this.itemName(x).zh}。`, `You take the ${this.itemName(x).en.toLowerCase()}.`)); }
    delete this.meta.corpses[this.run.level]; w.corpse = null; this.discover("own_corpse"); this.out.rebuild = true;
  }

  /* ---------- fallen backpack ---------- */
  private packExamine() {
    if (!this.canReachPack()) return;
    const p = this.run.lockedPack!, def = this.packPuzzle;
    if (!p.seen) {
      p.hasRuleNote = !this.meta.symbolLock.ruleNoteSeen && !this.meta.clues.includes(def.methodClue);
      this.meta.symbolLock.ruleNoteSeen = true; p.seen = true;
    }
    this.discover("fallen_pack"); this.say(def.text.description);
    if (!p.openedBy) this.say(p.jammed ? def.text.jammed : def.text.locked);
  }
  private packMarks() {
    if (!this.canReachPack()) return;
    const p = this.run.lockedPack!; if (p.marksSeen) return;
    this.pass(this.packPuzzle.minutes.examineMarks); if (this.run.ended) return;
    p.marksSeen = true; this.out.sfx.push("paper");
  }
  private openPack(by: "code" | "crowbar") {
    const p = this.run.lockedPack!, t = this.packPuzzle.text;
    p.openedBy = by; p.jammed = false;
    this.learn(this.packPuzzle.methodClue); this.discover("fallen_pack");
    this.say(by === "code" ? t.opened : t.forced); this.say(this.packInside); this.say(this.packPaper);
    this.out.caption = by === "code" ? t.openedCaption : t.forcedCaption;
    this.out.sfx.push(by === "code" ? "lock_open" : "lock_break"); this.out.rebuild = true;
  }
  private packAttempt(code: number[]) {
    if (!this.canReachPack()) return;
    const p = this.run.lockedPack!, def = this.packPuzzle;
    if (p.openedBy) return;
    if (!validCode(code)) return this.say(def.text.invalid);
    if (p.jammed) return this.say(def.text.jammed);
    this.pass(def.minutes.attempt); if (this.run.ended) return;
    if (matchesPack(p, code)) return this.openPack("code");
    p.failures++; p.jammed = p.failures >= def.jamAfter;
    this.say(def.text.failure); if (p.jammed) this.say(def.text.jammed);
    this.out.caption = def.text.failureCaption; this.out.sfx.push("lock_fail");
  }
  private packUnjam() {
    if (!this.canReachPack()) return;
    const p = this.run.lockedPack!; if (p.openedBy || !p.jammed) return;
    this.pass(this.packPuzzle.minutes.unjam); if (this.run.ended) return;
    p.jammed = false; p.failures = 0; this.say(this.packPuzzle.text.freed); this.out.sfx.push("rattle");
  }
  private packForce() {
    if (!this.canReachPack() || this.run.lockedPack!.openedBy) return;
    if (!this.has("crowbar")) return this.say(this.packPuzzle.text.needCrowbar);
    this.pass(this.packPuzzle.minutes.force); if (!this.run.ended) this.openPack("crowbar");
  }
  private packTake(key: string) {
    if (!this.canReachPack()) return;
    const p = this.run.lockedPack!, x = p.items.find(x => x.key === key); if (!p.openedBy || !x) return;
    if (this.weight() + this.item(x.id).weight > CARRY) return this.say(this.packPuzzle.text.full);
    this.pass(1); if (this.run.ended) return;
    p.items = p.items.filter(y => y !== x); this.run.inv.push(x);
    this.say(T(`你拿走了${this.itemName(x).zh}。`, `You take the ${this.itemName(x).en.toLowerCase()}.`));
  }

  /* ---------- the person in the room ---------- */
  private enterRoomPerson() {
    const r = this.run.roomPerson, m = this.meta.roomPerson, q = this.personQuest;
    if (r.separated && !r.returned) {
      r.returned = true; m.flags.returnedEmpty = true;
      this.say(this.personWater().length ? q.text.returnedWet : q.text.returnedDry); this.out.important = true;
    }
    if (r.entered) return;
    r.entered = true;
    if (r.eligible) m.misses = r.variant === "none" ? m.misses + 1 : 0;
    if (r.present) {
      if (!this.run.npcSeenThisRun.includes(q.npc)) {
        this.run.npcSeenThisRun.push(q.npc);
        this.meta.npcMeetings[q.npc] = (this.meta.npcMeetings[q.npc] ?? 0) + 1;
      }
      this.discover("room_person"); this.say(r.variant === "first" ? q.text.first : q.text.revisit);
      if (r.variant === "first") {
        if (this.run.stats.sanity < 35) this.say(q.text.lowSanity);
        this.say(this.meta.cabinet.length ? q.text.cabinetStocked : q.text.cabinetEmpty);
      }
      this.out.important = true;
    } else if (r.variant === "aftermath") {
      if (m.flags.helped && !m.suppliesGranted) {
        this.meta.cabinet.push({ key: `person:thanks:${this.run.run}`, id: "almond_water" }); m.suppliesGranted = true;
      }
      this.say(q.text.aftermath); this.out.important = true;
    }
  }
  private roomPersonTalk() {
    if (!this.canTalkToPerson()) return;
    const r = this.run.roomPerson, q = this.personQuest;
    if (!r.greeted) {
      r.greeted = true;
      this.say((this.meta.npcMeetings[q.npc] ?? 0) > 1 ? q.text.familiar : q.text.greeting);
      this.out.important = true;
    }
  }
  private roomPersonChoice(id: string, waterKey?: string) {
    if (!this.canTalkToPerson()) return;
    const r = this.run.roomPerson, m = this.meta.roomPerson, q = this.personQuest;
    const ch = this.personDialogue.choices.find(ch => ch.id === id);
    if (!ch || !personChoiceVisible(ch, r)) return;
    const water = this.run.inv.find(x => x.key === waterKey);
    if (ch.requires?.water && (!water || !sealedGreyWater(water))) return this.say(q.text.noWater);
    if (ch.action === "ask_leave" && !personReady(r)) return this.say(q.text.notReady);
    this.pass(ch.minutes); if (this.run.ended) return;
    this.out.important = true;
    if (ch.action === "give_water" || ch.action === "give_water_and_promise") {
      this.take(water!.key); r.helped = true; m.flags.helped = true;
      if (ch.action === "give_water_and_promise") r.promised = true;
    } else if (ch.action === "promise") r.promised = true;
    else if (ch.action === "wait") { r.waited = true; m.flags.waited = true; }
    this.say(ch.result);
    if (ch.action === "ask_leave") this.separateRoomPerson(true);
  }
  private separateRoomPerson(otherFirst: boolean) {
    const r = this.run.roomPerson, m = this.meta.roomPerson, q = this.personQuest;
    if (r.separated) return;
    r.present = false; r.separated = true;
    if (otherFirst) m.flags.sawOtherLeave = true;
    else { m.flags.leftFirst = true; if (r.promised) m.flags.promisedAndLeft = true; }
    this.learn(q.clues.separation); this.say(otherFirst ? q.text.personLeft : q.text.playerLeft); this.out.important = true; this.out.rebuild = true;
    if (r.variant === "first" && m.phase === "first") m.phase = "revisit";
    else if (r.variant === "revisit" && m.phase === "revisit") m.phase = "aftermath";
    if (!m.rewardClaimed) { m.rewardClaimed = true; r.rewardPending = true; }
  }
  private readPersonPaper() {
    if (this.run.roomPerson.variant !== "aftermath" || !this.run.roomPerson.entered || this.meta.roomPerson.phase === "complete") return;
    const q = this.personQuest, m = this.meta.roomPerson;
    this.learn(q.clues.aftermath);
    if (m.flags.promisedAndLeft) this.learn(q.clues.promise);
    if (m.flags.waited) this.learn(q.clues.waited);
    m.phase = "complete"; this.out.important = true; this.out.sfx.push("paper");
  }

  private rereadNotebook() {
    const r = this.run, block = notebookReadBlock(r);
    if (block) {
      const reason: Record<typeof block, Text> = {
        missing: T("你身上沒有筆記本。", "You aren't carrying a notebook."),
        blank: T("紙上還沒有畫下任何地方。", "No places drawn on the pages yet."),
        calm: T("你認得自己的字。現在不用再讀一遍。", "You recognise your handwriting. No need to read it again just now."),
        cooldown: T("那些線條還在腦裡。過幾個小時再讀吧。", "Those lines are still in your mind. Read again in a few hours.")
      };
      return this.say(reason[block]);
    }
    const gain = notebookReadGain(r);
    if (!this.pass(10) || r.ended) return;
    r.stats.sanity = Math.min(100, r.stats.sanity + gain); r.lastNotebookRead = r.time;
    this.say(gain === 4 ? T("你沿著歪斜的線條讀下去。有些地方認不出來，但握筆的是你。", "You follow the crooked lines. Some places are unreadable, but it was your hand holding the pen.")
      : T("你一頁一頁翻回去。走過的路，還留在紙上。呼吸慢了一點。", "You turn back through the pages. The places you walked are still on the paper. Your breathing slows."));
    this.out.sfx.push("paper");
  }

  /* ---------- Base Alpha ---------- */
  private supplyNotice(): Text {
    if (this.world.level !== "level-1") return this.elder.text.exhausted;
    const p = this.run.pos, crates = [...this.world.crates.values()].filter(c => c.kind !== "base" && c.kind !== "emergency" && (!c.opened || c.items.length))
      .sort((a, b) => Math.abs(a.i-p.i)+Math.abs(a.j-p.j)-Math.abs(b.i-p.i)-Math.abs(b.j-p.j));
    if (!crates.length) return this.elder.text.exhausted;
    const c = crates[0], east = c.i-p.i, south = c.j-p.j;
    const zh = [east ? `${east > 0 ? "東" : "西"} ${Math.abs(east)} 格` : "", south ? `${south > 0 ? "南" : "北"} ${Math.abs(south)} 格` : ""].filter(Boolean).join("、");
    const en = [east ? `${Math.abs(east)} ${east > 0 ? "east" : "west"}` : "", south ? `${Math.abs(south)} ${south > 0 ? "south" : "north"}` : ""].filter(Boolean).join(", ");
    return T(`最近的未收集標記：從這裡往${zh}。隔板可能要繞路。箱子可能在停電時消失；回來再核對告示。`, `Nearest uncollected marking: ${en} cells from here. Dividers may require a detour. Crates can vanish during blackouts; check the notice again when you return.`);
  }

  get elder() { return this.c.npcs[0]; }
  elderChoices() { return this.elder.choices.filter(ch => elderChoiceVisible(this.run, this.meta, ch)); }
  private meetAlphaElder() { for (const t of meetElder(this.run, this.meta, this.elder)) this.say(t); }

  /* ---------- developer panel (?dev) ---------- */
  devJump(where: "manila" | "red" | "flicker" | "outage" | "day" | "level1" | "alpha") {
    if (where === "level1") {
      if (this.run.level === "level-0") { this.out = { say: [], anim: { kind: "none" }, sfx: [], minutes: 0 }; this.enterLevel1(); } return;
    }
    if (where === "alpha") {
      if (this.world.level === "level-1") { const [i, j] = this.world.base; this.run.pos = { i, j, d: this.world.rotation }; this.world.ensureAround(i, j); recordNotebook(this.run, this.world, true); } return;
    }
    if (this.run.level !== "level-0") return;
    const r = this.run, w = this.level0;
    if (where === "day") { r.time += 24 * H; return; }
    if (where === "outage") { r.outageLeft = 4; r.lastOutage = r.moves; return; }
    if (where === "flicker") { const k = w.wallAhead(r.pos.i, r.pos.j, r.pos.d); if (k) { w.edges.set(k, "flicker"); w.flickerKey = k; } return; }
    let i: number, j: number, d: Dir;
    if (where === "manila") { [i, j] = w.manila; i -= 1; d = 1; w.ensureAround(i, j); }
    else {
      const core = w.redCoresNear(r.pos.i, r.pos.j)[0] ?? w.redCoresNear(16, 16)[0] ?? [8, 8];
      const ent = edgeCells(w.redEntrance(core[0], core[1])), out = ent.find(([a, b]) => a !== core[0] || b !== core[1])!;
      d = DV.findIndex(v => v[0] === core[0] - out[0] && v[1] === core[1] - out[1]) as Dir;
      i = out[0] - DV[d][0]; j = out[1] - DV[d][1]; w.ensureAround(i, j);
      w.edges.set(edgeKey(i, j, d), "open");
    }
    r.pos = { i, j, d }; w.ensureAround(i, j); recordNotebook(r, w, true);
  }

  private enterLevel1() {
    const r = this.run, first = !this.meta.discoveries.includes("level1") && !this.meta.endings.includes("exit_level1"), rules = this.c.levels[0];
    r.mapPages.push({ level: r.level, map: r.map, mapMarks: r.mapMarks }); r.map = {}; r.mapMarks = {};
    r.level = "level-1";
    r.l1 = { enteredAt: r.time, power: { phase: "normal", nextAt: 0 }, encounter: null, hazards: newLevel1Hazards(), baseClaimed: false, searches: 0, baseVisits: 0, elder: { met: false, meeting: null } };
    r.fakePiano = null; r.pendingEvent = null;
    this.world = new Level1(r.seed, rules); r.pos = { i: 0, j: 0, d: this.world.rotation };
    this.world.ensureAround(0, 0); this.placeCorpse(); r.world = this.world.toData();
    const reward = this.c.rewards[0];
    queueReward(r, "level1:arrival", T("抵達 Level 1", "Reached Level 1"), reward.arrival);
    if (first) queueReward(r, "level1:first", T("第一次發現：Level 1", "First discovery: Level 1"), reward.firstArrival);
    if (!this.meta.discoveries.includes("level1")) this.meta.discoveries.push("level1");
    this.say(first ? rules.arrival : rules.again); this.say(rules.zones.arrival);
    recordNotebook(r, this.world, true); this.out.levelChanged = true; this.out.rebuild = true; this.out.important = true;
  }

  /* ---------- ending ---------- */
  private end(id: string) {
    const r = this.run, m = this.meta; if (r.ended) return;
    const e = this.c.endings.find(x => x.id === id)!;
    const days = Math.floor(r.time / (24 * H));
    const breakdown: { label: Text; pts: number }[] = [];
    if (r.roomPerson.rewardPending) breakdown.push({ label: this.personQuest.text.reward, pts: this.personQuest.completionReward });
    if (r.level === "level-1") breakdown.push(...warehouseSurvival(r, this.c));
    else {
    if (days) breakdown.push({ label: T(`撐過了 ${days} 天`, `Survived ${days} day${days > 1 ? "s" : ""}`), pts: days * 10 });
    const hours = Math.floor(r.time / H); if (hours >= 6) breakdown.push({ label: T(`在 Level 0 待了 ${hours} 小時`, `${hours} hours in Level 0`), pts: Math.floor(hours / 6) * 2 });
    }
    for (const p of r.pendingRewards) breakdown.push({ label: p.label, pts: p.points });
    for (const f of r.found) breakdown.push({ label: T(`第一次發現：${DISC[f]?.zh ?? f}`, `First discovery: ${DISC[f]?.en ?? f}`), pts: 15 });
    const first = !m.endings.includes(id);
    if (e.kind === "death") { if (first) breakdown.push({ label: T("第一次經歷這種死法", "A death you had not known before"), pts: 10 }); }
    else breakdown.push({ label: T(first ? `第一次達成：${e.title.zh}` : e.title.zh, first ? `First time: ${e.title.en}` : e.title.en), pts: e.points * (first ? 2 : 1) });
    const pts = breakdown.reduce((s, x) => s + x.pts, 0);
    r.ended = { ending: id, points: pts, breakdown, days };
    if (r.level === "level-1") r.ended.level = r.level;
    m.points += pts; if (first) m.endings.push(id);
    for (const f of r.found) if (!m.discoveries.includes(f)) m.discoveries.push(f);
    m.history.push({ run: r.run, ending: id, days, points: pts });
    // the volunteer bottle that was moved into the stranger's pack goes back to the cabinet if nobody took it
    if (r.lockedPack?.story === "room_person") for (const x of r.lockedPack.items) if (x.key.startsWith("vol")) m.cabinet.push(x);
    // Keep only this level's latest recoverable body; other layers are untouched.
    if (e.kind === "death" && id !== "no_one_returned") {
      m.corpses[r.level] = { run: r.run, cause: id, items: r.inv.filter(x => r.carried.includes(x.id) || x.id !== "bottle").slice(0, 6), note: CORPSE_NOTE[id] ?? T("不要停下來。", "Don't stop.") };
    }
    this.out.ended = true;
  }
}

/* ---------- small helpers ---------- */
function weighted(x: number, table: [string, number][]) { const tot = table.reduce((s, t) => s + t[1], 0); let a = x * tot; for (const [id, w] of table) { if ((a -= w) < 0) return id; } return table[0][0]; }
function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }
function ordinal(n: number) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
export function swingAway(edge: string, pi: number, pj: number): number {      // which way a door swings open: away from whoever opened it
  const [[a, b]] = edgeCells(edge), vert = edge[0] === "v", x = vert ? (a + .5) * 4 : a * 4, z = vert ? b * 4 : (b + .5) * 4, rot = vert ? Math.PI / 2 : 0;
  const px = pi * 4 - x, pz = pj * 4 - z;
  for (const ang of [1.65, -1.65]) if (Math.cos(rot + ang) * px - Math.sin(rot + ang) * pz < 0) return ang;
  return 1.65;
}
export const DISC: Record<string, Text> = {
  base_alpha: T("Alpha 基地", "Base Alpha"), supply_crate: T("補給箱", "a supply crate"), level1: T("Level 1", "Level 1"),
  zone_arch: T("拱門區", "the arch zone"), zone_pillar: T("柱林", "the pillar field"), zone_dark: T("斷電區", "the blackout zone"), zone_pit: T("坑洞區", "the pits"),
  manila: T("曼尼拉房間", "the Manila Room"), red_signs: T("紅房間", "a red room"), flicker_wall: T("閃爍的牆", "the flickering wall"),
  ceiling_stash: T("天花板夾層", "the ceiling void"), firesalt: T("火鹽", "firesalt"), liquid_pain: T("Liquid Pain", "Liquid Pain"),
  own_corpse: T("自己的遺體", "your own body"), tally_marks: T("牆上的記號", "the marks on the wall"), fallen_pack: T("上鎖的舊背包", "the locked backpack"), room_person: T("房裡的人", "the person in the room")
};
const CORPSE_NOTE: Record<string, Text> = {
  death_smiler: T("笑臉看的是光。先收起來。", "The smile follows the light. Put it away first."),
  death_dehydration: T("水。一定要找到水。不要省著喝，省著喝的人都死了。", "Water. Find water. Don't ration it; the ones who rationed are dead."),
  death_wretch: T("我想不起來我叫什麼。如果你記得，寫在這張紙背面。", "I can't remember my name. If you do, write it on the back of this."),
  death_liquid_pain: T("顏色淡得像果汁的那種，不是杏仁水。不要喝。", "The kind that looks like watered-down juice is not almond water. Don't drink it."),
  death_injury: T("小心天花板的邊。還有不要一個人……算了。", "Mind the ceiling edges. And don't go alone... never mind.")
};
export { edgeKey };
