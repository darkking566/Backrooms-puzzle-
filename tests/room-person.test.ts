import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { draw, type Stream } from "../src/core/rng";
import { edgeKey } from "../src/world/level0";
import { newMeta } from "../src/state/types";
import { exportSave, importSave } from "../src/state/save";
import { packCode } from "../src/systems/symbol-lock";
import { planRoomPerson, sealedGreyWater } from "../src/systems/room-person";
import { loadContent } from "../tools/content-plugin";
const c = loadContent(), quest = c.quests[0];
function meta() { const m = newMeta(); m.runs = 2; m.discoveries.push("manila"); m.roomPerson.misses = 2; return m; }
function game(m = meta(), seed = 73) { return Game.newRun(c, m, seed, []); }
function clearEvent(g: Game) { if (g.run.pendingEvent && !g.run.ended) g.dispatch({ type: "choose", index: 0 }); }
function enter(g: Game) { g.devJump("manila"); g.dispatch({ type: "door", edge: edgeKey(g.run.pos.i, g.run.pos.j, 1) }); g.dispatch({ type: "move", d: 1 }); clearEvent(g); }
function leave(g: Game) { g.dispatch({ type: "move", d: 3 }); clearEvent(g); }
function finish(g: Game) { clearEvent(g); g.run.stats.water = 0; g.run.stats.health = .001; g.dispatch({ type: "turn", dir: 1 }); expect(g.run.ended).not.toBeNull(); }
function next(g: Game, seed: number) { finish(g); g.meta.roomPerson.misses = 2; return game(g.meta, seed); }
function open(g: Game) { g.dispatch({ type: "packExamine" }); g.dispatch({ type: "packAttempt", code: packCode(g.run.lockedPack!) }); }
function takeWater(g: Game) { open(g); const key = g.run.lockedPack!.items[0].key; g.dispatch({ type: "packTake", key }); return key; }
function reload(g: Game) { const s = importSave(exportSave(g.meta, g.save())); return new Game(c, s.meta, s.run!); }

describe("room person selection and supplies", () => {
  it("requires a previous Manila discovery and at least awakening three", () => {
    const m = newMeta(); expect(planRoomPerson(quest, m, () => 0).variant).toBe("none");
    m.runs = 3; expect(planRoomPerson(quest, m, () => 0).variant).toBe("none");
    m.discoveries.push("manila"); expect(planRoomPerson(quest, m, () => .34).variant).toBe("first"); expect(planRoomPerson(quest, m, () => .35).variant).toBe("none");
    m.roomPerson.phase = "revisit"; expect(planRoomPerson(quest, m, () => .49).variant).toBe("revisit"); expect(planRoomPerson(quest, m, () => .5).variant).toBe("none");
    m.roomPerson.phase = "aftermath"; expect(planRoomPerson(quest, m, () => .99).variant).toBe("aftermath");
    m.roomPerson.phase = "complete"; expect(planRoomPerson(quest, m, () => 0).variant).toBe("none");
  });
  it("counts only a run's actual first room visit toward pity, and forces the third", () => {
    const m = meta(); m.roomPerson.misses = 0;
    for (let k = 0; k < 2; k++) {
      let g: Game; let seed = k * 100;
      do { g = game(m, seed++); } while (g.run.roomPerson.variant !== "none");
      expect(m.roomPerson.misses).toBe(k); enter(g); expect(m.roomPerson.misses).toBe(k + 1);
      leave(g); g.dispatch({ type: "move", d: 1 }); expect(m.roomPerson.misses).toBe(k + 1);
    }
    const forced = game(m, 12); expect(forced.run.roomPerson.variant).toBe("first"); enter(forced); expect(m.roomPerson.misses).toBe(0);
  });
  it.each([0, 1, 2, 3])("preserves %i stored bottles and redirects only a new volunteer bottle", count => {
    const m = meta(); for (let k = 0; k < count; k++) m.cabinet.push({ key: `kept${k}`, id: "almond_water" });
    m.cabinet.push({ key: "tool", id: "watch" }); const before = structuredClone(m.cabinet), g = game(m);
    expect(m.cabinet).toEqual(before); expect(g.run.lockedPack!.items.filter(x => x.id === "almond_water")).toHaveLength(count < 2 ? 2 : 1);
    expect(g.run.packPlan).toBe("none"); expect(g.run.lockedPack!.story).toBe("room_person");
    expect(g.level0.inManila(g.run.lockedPack!.pos.i, g.run.lockedPack!.pos.j)).toBe(true);
    enter(g); expect(g.run.log.some(x => x.t.en.includes("still supplies"))).toBe(true);
  });
  it("returns an untaken volunteer bottle to the cabinet when the run ends", () => {
    const unseen = game(); expect(unseen.meta.cabinet).toHaveLength(0); finish(unseen);
    expect(unseen.meta.cabinet.map(x => x.key)).toEqual(["vol3"]);
    const taken = game(); enter(taken); open(taken); const vol = taken.run.lockedPack!.items.find(x => x.key.startsWith("vol"))!;
    taken.dispatch({ type: "packTake", key: vol.key }); finish(taken);
    expect(taken.meta.cabinet.some(x => x.key === vol.key)).toBe(false);
  });
  it("uses the truthful empty-cabinet text and retains ordinary stocking on a miss", () => {
    const g = game(); enter(g); expect(g.meta.cabinet).toHaveLength(0); expect(g.run.log.some(x => x.t.en.includes("No water inside"))).toBe(true);
    const m = newMeta(), plain = game(m); expect(plain.run.roomPerson.variant).toBe("none"); expect(m.cabinet).toHaveLength(1);
  });
});

describe("room person choices and separation", () => {
  it("keeps dialogue optional and consumes exactly the chosen safe bottle once", () => {
    const g = game(); enter(g); g.dispatch({ type: "roomPersonTalk" }); const time = g.run.time;
    g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: "missing" }); expect(g.run.time).toBe(time);
    const key = takeWater(g), remaining = g.run.lockedPack!.items[0].key; g.dispatch({ type: "packTake", key: remaining });
    expect(g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: remaining }).minutes).toBe(3);
    expect(g.run.inv.some(x => x.key === key)).toBe(true); expect(g.run.inv.some(x => x.key === remaining)).toBe(false);
    expect(g.run.roomPerson.promised).toBe(true); expect(g.meta.roomPerson.flags.promisedAndLeft).toBe(false);
    expect(g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: key }).minutes).toBe(0);
    expect(g.run.pendingEvent).toBeNull();
    g.dispatch({ type: "move", d: 1 }); expect(g.run.roomPerson.separated).toBe(false); g.dispatch({ type: "move", d: 3 });
    leave(g); expect(g.run.roomPerson.present).toBe(false); expect(g.meta.roomPerson.flags.promisedAndLeft).toBe(true);
    expect(g.meta.roomPerson.phase).toBe("revisit"); expect(g.meta.clues).toContain(quest.clues.separation);
  });
  it("accepts a full sealed grey flask, rejects other liquids and partial bottles", () => {
    const g = game(); enter(g);
    const b = { key: "flask", id: "bottle", bottle: { liquid: "aw_grey", color: "grey" as const, full: true, sealed: true, spoiled: false } };
    expect(sealedGreyWater(b)).toBe(true); expect(sealedGreyWater({ ...b, bottle: { ...b.bottle, full: false } })).toBe(false);
    expect(sealedGreyWater({ ...b, bottle: { ...b.bottle, sealed: false } })).toBe(false);
    expect(sealedGreyWater({ ...b, bottle: { ...b.bottle, liquid: "liquid_pain" } })).toBe(false);
    g.run.inv.push(b); g.dispatch({ type: "roomPersonChoice", id: "give_water", waterKey: "flask" }); expect(g.meta.roomPerson.flags.helped).toBe(true); expect(g.run.inv).toHaveLength(0);
  });
  it("waits once without an NPC death timer or repeat reward", () => {
    const g = game(); enter(g); const water = g.run.stats.water, sanity = g.run.stats.sanity;
    expect(g.dispatch({ type: "roomPersonChoice", id: "wait" }).minutes).toBe(30); expect(g.run.stats.water).toBeLessThan(water); expect(g.run.stats.sanity).toBeGreaterThan(sanity);
    expect(g.dispatch({ type: "roomPersonChoice", id: "wait" }).minutes).toBe(0); expect(g.meta.roomPerson.flags.waited).toBe(true);
    g.dispatch({ type: "rest", hours: 8 }); expect(g.run.roomPerson.present).toBe(true); expect(g.meta.roomPerson.rewardClaimed).toBe(false);
  });
  it("lets a restored person leave first, without claiming the player departed", () => {
    const g = game(); enter(g); expect(g.dispatch({ type: "roomPersonChoice", id: "ask_leave" }).minutes).toBe(0);
    const key = takeWater(g); g.dispatch({ type: "roomPersonChoice", id: "give_water", waterKey: key });
    const out = g.dispatch({ type: "roomPersonChoice", id: "ask_leave" }); expect(out.minutes).toBe(5); expect(out.say.at(-1)?.en).toContain("cross the threshold");
    expect(g.meta.roomPerson.flags.sawOtherLeave).toBe(true); expect(g.meta.roomPerson.flags.leftFirst).toBe(false); expect(g.zoneHere()).toBe("manila");
    expect(g.dispatch({ type: "roomPersonChoice", id: "wait" }).minutes).toBe(0);
  });
  it("allows leaving without water and finding a living person in a later run", () => {
    const g = game(); enter(g); leave(g); expect(g.meta.roomPerson.flags.helped).toBe(false); expect(g.meta.roomPerson.flags.leftFirst).toBe(true);
    const later = next(g, 74); enter(later); expect(later.run.roomPerson.variant).toBe("revisit"); expect(later.canTalkToPerson()).toBe(true);
    expect(later.dispatch({ type: "roomPersonChoice", id: "ask_leave" }).minutes).toBe(5);
  });
  it("records returning separately from actually leaving water and does not finish the main story", () => {
    const g = game(); enter(g); const key = takeWater(g); g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: key });
    const spare = g.run.lockedPack!.items[0].key; g.dispatch({ type: "packTake", key: spare }); leave(g); g.dispatch({ type: "move", d: 1 });
    expect(g.run.roomPerson.returned).toBe(true); expect(g.meta.roomPerson.flags.returnedEmpty).toBe(true); expect(g.meta.roomPerson.flags.returnedWater).toBe(false);
    g.dispatch({ type: "cabinetPut", key: spare }); expect(g.meta.roomPerson.flags.returnedWater).toBe(true); expect(g.meta.clues).toContain(quest.clues.returned);
    expect(g.meta.roomPerson.phase).toBe("revisit"); expect(g.meta.endings).toHaveLength(0);
  });
  it("preserves completed actions through death but never invents a departure", () => {
    const g = game(); enter(g); const key = takeWater(g); g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: key }); finish(g);
    expect(g.meta.roomPerson.flags.helped).toBe(true); expect(g.meta.roomPerson.flags.promisedAndLeft).toBe(false); expect(g.meta.roomPerson.phase).toBe("first"); expect(g.meta.roomPerson.rewardClaimed).toBe(false);
  });
  it("does not consume water or record completion if the action kills the player", () => {
    const g = game(); enter(g); const key = takeWater(g); g.run.stats.water = 0; g.run.stats.health = .001;
    g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: key }); expect(g.run.ended).not.toBeNull(); expect(g.run.inv.some(x => x.key === key)).toBe(true); expect(g.meta.roomPerson.flags.helped).toBe(false);
  });
  it("rejects remote and event-blocked choices without touching resources", () => {
    const g = game(); g.run.inv.push({ key: "water", id: "almond_water" }); const before = structuredClone(g.run);
    g.dispatch({ type: "roomPersonChoice", id: "give_water", waterKey: "water" }); expect(g.run).toEqual(before);
    enter(g); g.run.pendingEvent = "noise_spike"; expect(g.dispatch({ type: "roomPersonChoice", id: "wait" }).minutes).toBe(0); expect(g.run.roomPerson.waited).toBe(false);
  });
});

describe("cross-run revelations and saves", () => {
  it("reveals three stages across runs, preserves user notes, and gives one thank-you bottle", () => {
    const g = game(); g.meta.notes.push({ run: 1, t: "我的紙條" }); enter(g); const key = takeWater(g);
    g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: key }); g.dispatch({ type: "roomPersonChoice", id: "wait" }); leave(g);
    const second = next(g, 74); enter(second); expect(second.meta.npcMeetings[quest.npc]).toBe(2); expect(second.dispatch({ type: "roomPersonTalk" }).say[0]).toEqual(quest.text.familiar);
    second.dispatch({ type: "roomPersonTalk" }); expect(second.meta.npcMeetings[quest.npc]).toBe(2); leave(second);
    const third = next(second, 75); expect(third.run.roomPerson.variant).toBe("aftermath"); expect(third.meta.clues).not.toContain(quest.clues.aftermath);
    const before = third.meta.cabinet.length; enter(third); expect(third.meta.cabinet.length).toBe(before + 1); expect(third.canTalkToPerson()).toBe(false);
    expect(third.meta.roomPerson.phase).toBe("aftermath"); third.dispatch({ type: "examine", what: "notes" }); expect(third.meta.roomPerson.phase).toBe("complete");
    expect(third.meta.clues).toEqual(expect.arrayContaining([quest.clues.aftermath, quest.clues.promise, quest.clues.waited])); expect(third.meta.notes).toEqual([{ run: 1, t: "我的紙條" }]);
    leave(third); third.dispatch({ type: "move", d: 1 }); expect(third.meta.cabinet.length).toBe(before + 1);
    const resumed = reload(third); resumed.dispatch({ type: "examine", what: "notes" }); expect(resumed.meta.cabinet.length).toBe(before + 1);
    const fourth = next(third, 76); expect(fourth.run.roomPerson.variant).toBe("none");
  });
  it("awards the separation reward just once and includes it in the ending breakdown", () => {
    const g = game(); enter(g); leave(g); const b = reload(g); expect(b.run.roomPerson.rewardPending).toBe(true);
    finish(b); expect(b.run.ended!.breakdown.filter(x => x.label.en === quest.text.reward.en)).toEqual([{ label: quest.text.reward, pts: 20 }]);
    b.meta.roomPerson.misses = 2; const second = game(b.meta, 74); enter(second); leave(second); finish(second); expect(second.run.ended!.breakdown.some(x => x.label.en === quest.text.reward.en)).toBe(false);
  });
  it("keeps uncompleted first-stage greetings at the second and third encounter only", () => {
    const g = game(); enter(g); expect(g.dispatch({ type: "roomPersonTalk" }).say[0]).toEqual(quest.text.greeting);
    let old = g;
    for (let count = 2; count <= 4; count++) { const n = next(old, count + 80); enter(n); expect(n.meta.npcMeetings[quest.npc]).toBe(count); expect(n.dispatch({ type: "roomPersonTalk" }).say[0]).toEqual(quest.text.familiar); old = n; }
  });
  it("does not reroll encounter, gift, promise or NPC count on reload", () => {
    const g = game(); enter(g); const key = takeWater(g); g.dispatch({ type: "roomPersonChoice", id: "give_and_promise", waterKey: key });
    const saved = JSON.stringify(g.save()), m = structuredClone(g.meta), b = reload(g); expect(JSON.stringify(b.save())).toBe(saved); expect(b.meta).toEqual(m);
    b.dispatch({ type: "roomPersonTalk" }); expect(b.meta.npcMeetings[quest.npc]).toBe(1); expect(b.meta.roomPerson.flags.helped).toBe(true);
    leave(b); expect(b.meta.roomPerson.flags.promisedAndLeft).toBe(true);
  });
  it("keeps real interactions available at low sanity and protects departure feedback", () => {
    const g = game(); g.run.stats.sanity = 5; enter(g); expect(g.run.log.some(x => x.t.en === quest.text.lowSanity.en)).toBe(true);
    expect(g.canTalkToPerson()).toBe(true); const key = takeWater(g); g.dispatch({ type: "roomPersonChoice", id: "give_water", waterKey: key });
    const out = g.dispatch({ type: "roomPersonChoice", id: "ask_leave" }); expect(out.important).toBe(true); expect(out.perceivedTime).toBeUndefined(); expect(g.meta.roomPerson.flags.helped).toBe(true);
  });
  it("uses quests/puzzles without consuming the six old streams", () => {
    const g = game(), counters = structuredClone(g.run.rng);
    enter(g); takeWater(g); // entering uses old movement streams, so compare only a subsequent dialogue sequence
    const before = structuredClone(g.run.rng); g.dispatch({ type: "roomPersonTalk" }); g.dispatch({ type: "roomPersonChoice", id: "ask_door" }); g.dispatch({ type: "roomPersonChoice", id: "wait" });
    for (const s of ["misc", "events", "loot", "body", "shift", "halluc"] as Stream[]) expect(draw(g.run.rng, s)).toBe(draw(before, s));
    expect(counters.counters.quests ?? 0).toBe(0); // pity selection needs no draw
  });
});
