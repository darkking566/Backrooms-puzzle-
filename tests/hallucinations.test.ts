import { afterEach, describe, expect, it, vi } from "vitest";
import { loadContent } from "../tools/content-plugin";
import { Game, type Command } from "../src/core/game";
import { DV, T, type Dir } from "../src/core/types";
import { newHallucinations, newMeta, type RunState } from "../src/state/types";
import { exportSave, importSave, loadRun, persist, wipe } from "../src/state/save";
import * as hallucinations from "../src/systems/hallucinations";
import { lieChance, perceive, pianoLevels, PIANO_CAPTION, rememberHallucination, type PerceptionAction } from "../src/systems/hallucinations";
import { passable, type Zone } from "../src/world/level0";
import { elapsedMessages } from "../src/ui/time";

const c = loadContent(), clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const action: PerceptionAction = { action: "move", minutes: 13, previousSanity: 20, important: false };
const draws = (...values: number[]) => { let n = 0; return vi.fn(() => values[n++] ?? .99); };
function setup(zone: Zone = "hall", sanity = 20, dm = 20) {
  const g = Game.newRun(c, newMeta(), 2024, []); g.run.stats.sanity = sanity; g.run.time = 100;
  vi.spyOn(g.world, "zone").mockReturnValue(zone);
  vi.spyOn(g.world, "manilaDist").mockReturnValue(dm);
  return g;
}
afterEach(() => { vi.restoreAllMocks(); });

describe("false piano", () => {
  it.each([35, 50, 82])("does not generate a source or lies at sanity %s", sanity => {
    const g = setup("hall", sanity), rand = draws(0);
    expect(perceive(g.run, g.world, action, rand)).toEqual({ say: [] });
    expect(g.run.fakePiano).toBeNull(); expect(g.run.halluc.history).toEqual([]); expect(rand).not.toHaveBeenCalled();
  });

  it("generates a fixed source four to eight cells away for three game hours", () => {
    const g = setup(); perceive(g.run, g.world, action, draws(0, .4));
    const f = g.run.fakePiano!;
    expect(f).not.toBeNull(); expect(Math.hypot(f.i, f.j)).toBeGreaterThanOrEqual(4);
    expect(Math.hypot(f.i, f.j)).toBeLessThanOrEqual(8); expect(f.until).toBe(280);
    expect(g.world.inManila(f.i, f.j)).toBe(false);
  });

  it("grows louder on approach, fades nearby and vanishes with narration", () => {
    const g = setup(); g.run.fakePiano = { i: 0, j: -5, until: 1000, heard: true };
    const distant = pianoLevels(g.run, g.world).piano;
    g.run.pos.j = -2; const closer = pianoLevels(g.run, g.world).piano;
    expect(closer).toBeGreaterThan(distant);
    g.run.pos.j = -3; expect(pianoLevels(g.run, g.world).piano).toBeLessThan(closer);
    g.run.pos.j = -4;
    const out = perceive(g.run, g.world, action, draws(0));
    expect(g.run.fakePiano).toBeNull(); expect(pianoLevels(g.run, g.world).piano).toBe(0);
    expect(out.say).toContainEqual(T("琴聲停了。這裡什麼都沒有。", "The piano stops. There is nothing here."));
    expect(g.run.halluc.pianoAfter).toBe(460);
  });

  it.each(["arch", "manila"] as const)("does not generate lies in %s and removes a carried-over source", zone => {
    const g = setup(zone), rand = draws(0);
    expect(perceive(g.run, g.world, action, rand)).toEqual({ say: [] });
    g.run.fakePiano = { i: 5, j: 0, until: 1000, heard: true };
    perceive(g.run, g.world, action, rand);
    expect(g.run.fakePiano).toBeNull(); expect(g.run.halluc.history).toEqual([]); expect(rand).not.toHaveBeenCalled();
  });

  it.each([5, 7.5])("keeps real piano territory clear of false sources at distance %s", distance => {
    const g = setup("hall", 20, distance);
    // Suppress ordinary lies so this test exercises only source generation.
    g.run.halluc.lieAfter = 1000; perceive(g.run, g.world, action, draws(0));
    expect(g.run.fakePiano).toBeNull();
    g.run.fakePiano = { i: 4, j: 0, until: 1000, heard: true };
    const levels = pianoLevels(g.run, g.world);
    expect(levels.fake).toBe(0); expect(levels.piano).toBe(levels.real);
    const out = perceive(g.run, g.world, action, draws(0));
    expect(g.run.fakePiano).toBeNull(); expect(out.say).toEqual([]);
  });

  it.each(["expiry", "recovery"])("clears on %s and observes a six-hour cooldown", reason => {
    const g = setup(); g.run.fakePiano = { i: 5, j: 0, until: reason === "expiry" ? 100 : 1000, heard: true };
    if (reason === "recovery") g.run.stats.sanity = 50;
    perceive(g.run, g.world, action, draws(.99));
    expect(g.run.fakePiano).toBeNull(); expect(g.run.halluc.pianoAfter).toBe(460);
    g.run.stats.sanity = 20;
    perceive(g.run, g.world, action, draws(0)); expect(g.run.fakePiano).toBeNull();
    g.run.time = 460; perceive(g.run, g.world, action, draws(0, .5)); expect(g.run.fakePiano).not.toBeNull();
  });

  it("records deception only when the source becomes audible, and only once", () => {
    const g = setup(); g.run.fakePiano = { i: 7, j: 0, until: 1000, heard: false };
    const quiet = { ...action, action: null };
    perceive(g.run, g.world, quiet, draws(.99)); expect(g.run.halluc.history).toEqual([]);
    g.run.pos.i = 3;
    perceive(g.run, g.world, quiet, draws(.99)); perceive(g.run, g.world, quiet, draws(.99));
    expect(g.run.halluc.history).toHaveLength(1); expect(g.run.halluc.history[0].text).toEqual(PIANO_CAPTION);
    expect(g.run.fakePiano.heard).toBe(true);
  });
});

describe("unreliable narration", () => {
  it("increases from ten to thirty percent as sanity falls", () => {
    expect(lieChance(35)).toBe(0); expect(lieChance(34.999)).toBeCloseTo(.1, 3);
    expect(lieChance(20)).toBeCloseTo(.22); expect(lieChance(10)).toBeCloseTo(.3); expect(lieChance(0)).toBeCloseTo(.3);
  });

  it("uses ordinary-looking narration for false familiarity and enforces its cooldown", () => {
    const g = setup(); g.run.halluc.pianoAfter = 1000;
    const out = perceive(g.run, g.world, action, draws(0, 0, 0));
    expect(out.say[0].zh).toContain("這裡你好像來過");
    expect(g.run.halluc.history[0].kind).toBe("memory"); expect(g.run.halluc.lieAfter).toBe(160);
    expect(perceive(g.run, g.world, action, draws(0))).toEqual({ say: [] });
  });

  it("never distorts time with a watch or adds lies to important feedback", () => {
    const g = setup(); g.run.inv.push({ id: "watch", key: "watch" });
    const rest = { ...action, action: "rest" as const, minutes: 120 };
    expect(perceive(g.run, g.world, rest, draws(0)).perceivedTime).toBeUndefined();
    const rand = draws(0);
    expect(perceive(g.run, g.world, { ...action, important: true }, rand)).toEqual({ say: [] });
    expect(rand).not.toHaveBeenCalled(); expect(g.run.halluc.history).toEqual([]);
  });

  it("uses the identical perceived duration in the clock, elapsed overlay and sleep overlay", () => {
    const g = setup(), rest = { ...action, action: "rest" as const, minutes: 120 };
    const out = perceive(g.run, g.world, rest, draws(0, 0, 0));
    expect(out.perceivedTime).toEqual(T("一會兒", "a moment"));
    expect(g.run.halluc.history[0].actualMinutes).toBe(120);
    const texts = elapsedMessages(120, false, out.perceivedTime);
    expect(texts.delta).toEqual(T("+一會兒", "+a moment"));
    expect(texts.passed).toEqual(T("……過了一會兒。", "...Time passes: a moment."));
    expect(texts.slept).toEqual(T("……你醒了過來。睡了一會兒。", "...You wake. You slept a moment."));
    expect(elapsedMessages(120, true, out.perceivedTime).duration).toEqual(T("2 小時", "2 h"));
    expect(g.run.time).toBe(100); // perception cannot advance or change survival time
  });

  it("keeps only the latest fifty entries while their ids remain unique", () => {
    const g = setup();
    for (let k = 0; k < 55; k++) rememberHallucination(g.run, "memory", T(`記憶 ${k}`, `Memory ${k}`));
    expect(g.run.halluc.history).toHaveLength(50);
    expect(g.run.halluc.history[0].id).toBe(6); expect(g.run.halluc.history[49].id).toBe(55);
  });

  it("can reflect once on recovery to fifty after a deception", () => {
    const g = setup("arch", 50); rememberHallucination(g.run, "memory", T("轉角。", "The corner."));
    const out = perceive(g.run, g.world, { ...action, previousSanity: 49 }, draws(0));
    expect(out.say).toContainEqual(T("你不確定剛才看到的是不是真的。", "You're not sure what you saw earlier was real."));
    expect(g.run.halluc.needsReflection).toBe(false);
    expect(perceive(g.run, g.world, action, draws(0)).say).toEqual([]);
  });
});

describe("hallucination integration and saves", () => {
  const play = () => {
    const g = Game.newRun(c, newMeta(), 2024, ["flashlight"]); g.run.stats.sanity = 20;
    const commands: Command[] = [];
    for (let step = 0; step < 100 && !g.run.ended; step++) {
      let command: Command;
      if (g.run.pendingEvent) command = { type: "choose", index: 0 };
      else if (step % 7 === 0) command = { type: "search" };
      else {
        const { i, j, d } = g.run.pos;
        const go = ([d, (d + 1) % 4, (d + 3) % 4, (d + 2) % 4] as Dir[])
          .find(dir => passable(g.world.edgeAt(i, j, dir)) && !["red", "pit"].includes(g.world.zone(i + DV[dir][0], j + DV[dir][1])));
        command = go === undefined ? { type: "turn", dir: 2 } : { type: "move", d: go };
      }
      commands.push(command); g.dispatch(command);
    }
    return { run: clone(g.save()), commands };
  };

  it("replays the same perceptions from the same seed and commands", () => {
    const a = play(), b = play(); expect(a.run.halluc.history.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("does not alter existing random streams, world changes, survival or action results", () => {
    const observed = play();
    const disabled = vi.spyOn(hallucinations, "perceive").mockReturnValue({ say: [] });
    const baseline = play();
    expect(disabled).toHaveBeenCalled();
    const actual = observed.run, expected = baseline.run;
    expect(observed.commands).toEqual(baseline.commands);
    delete actual.rng.counters.halluc; delete expected.rng.counters.halluc;
    actual.fakePiano = expected.fakePiano = null; actual.halluc = expected.halluc = newHallucinations(); actual.log = expected.log = [];
    expect(actual).toEqual(expected);
  });

  it("does not roll or change perceptions while editing a map without spending time", () => {
    const g = Game.newRun(c, newMeta(), 2024, ["notebook"]); g.run.stats.sanity = 20;
    const before = clone({ rng: g.run.rng, halluc: g.run.halluc });
    g.dispatch({ type: "mapMark", key: "0,0", mark: { kind: "water" } });
    expect({ rng: g.run.rng, halluc: g.run.halluc }).toEqual(before); expect(g.run.time).toBe(0);
  });

  it("loads and imports old v1 runs with default hallucination fields and a new stream", async () => {
    await wipe(); const g = Game.newRun(c, newMeta(), 2024, []);
    g.dispatch({ type: "move", d: 0 });
    const legacy: Partial<RunState> = clone(g.save());
    delete legacy.halluc; delete legacy.fakePiano; delete legacy.rng!.counters.halluc;
    const oldCounters = clone(legacy.rng!.counters);
    await persist(g.meta, legacy as RunState); const loaded = (await loadRun())!;
    expect(loaded.v).toBe(1); expect(loaded.halluc).toEqual(newHallucinations()); expect(loaded.fakePiano).toBeNull();
    expect(loaded.rng.counters).toEqual({ ...oldCounters, halluc: 0 });
    expect(importSave(exportSave(g.meta, legacy as RunState)).run).toEqual(loaded);
    expect(new Game(c, g.meta, loaded).dispatch({ type: "turn", dir: 1 }).minutes).toBe(1);
    await wipe();
  });

  it("preserves sources, cooldowns, history and RNG on resume without rerolling", async () => {
    await wipe(); const g = setup();
    perceive(g.run, g.world, action, draws(0, .4));
    for (let k = 0; k < 55; k++) rememberHallucination(g.run, "sound", PIANO_CAPTION);
    g.run.halluc.lieAfter = 300;
    const saved = clone(g.save()); await persist(g.meta, saved);
    expect(await loadRun()).toEqual(saved);
    const imported = importSave(exportSave(g.meta, saved));
    expect(new Game(c, imported.meta, imported.run!).run).toEqual(saved);
    expect(imported.run!.halluc.history).toHaveLength(50);
    await wipe();
  });
});
