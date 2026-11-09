import { describe, expect, it } from "vitest";
import { loadContent } from "../tools/content-plugin";
import { EVENT_GAP, Game } from "../src/core/game";
import { newMeta } from "../src/state/types";
import { runDefaults } from "../src/state/save";
import { H } from "../src/systems/survival";

const c = loadContent();
/** Content with only the given events, each forced to fire whenever it is eligible. */
function only(...ids: string[]) {
  const events = ids.map(id => { const e = c.events.find(x => x.id === id)!; return { ...e, trigger: { ...e.trigger, chance: 1, minHours: undefined } }; });
  return Game.newRun({ ...c, events }, newMeta(), 7, []);
}
/** Calls the private per-step check the way move/rest do, with a fresh output buffer. */
function fire(g: Game, on: string, z: string) {
  const p = g as unknown as { out: unknown; maybeEvent(on: string, z: string): void };
  p.out = { say: [], anim: { kind: "none" }, sfx: [], minutes: 0 }; p.maybeEvent(on, z);
}
const roll = (g: Game, z = "hall", on: "move" | "rest" = "move") => {
  fire(g, on, z);
  const id = g.run.pendingEvent; if (id) g.dispatch({ type: "choose", index: 0 }); return id;
};

describe("level 0 events", () => {
  it("an event waits out its own cooldown before firing again", () => {
    const g = only("noise_spike"), cd = c.events.find(e => e.id === "noise_spike")!.cooldown;
    expect(roll(g)).toBe("noise_spike");
    g.run.time = g.run.eventLast.noise_spike + cd * H - 1; expect(roll(g)).toBeNull();
    g.run.time += 1; expect(roll(g)).toBe("noise_spike");
  });
  it("no two events fire within the global gap", () => {
    const g = only("noise_spike", "flicker_wave");
    const first = roll(g)!; expect(first).not.toBeNull();
    g.run.time = g.run.eventLast[first] + EVENT_GAP - 1; expect(roll(g)).toBeNull();
    g.run.time += 1; expect(roll(g)).toBe(first === "noise_spike" ? "flicker_wave" : "noise_spike");
  });
  it("maxPerRun caps repeats and once: per_run fires once", () => {
    const g = only("dejavu"), max = c.events.find(e => e.id === "dejavu")!.maxPerRun!;
    let n = 0; for (let k = 0; k < max + 3; k++) { if (roll(g)) n++; g.run.time += 24 * H; }
    expect(n).toBe(max);
    const w = only("whisper"); expect(roll(w)).toBe("whisper"); w.run.time += 99 * H; expect(roll(w)).toBeNull();
  });
  it("zones and trigger kind are respected", () => {
    expect(roll(only("pit_echo"), "hall")).toBeNull();
    expect(roll(only("pit_echo"), "pit")).toBe("pit_echo");
    expect(roll(only("dream_outside"), "hall", "move")).toBeNull();
    expect(roll(only("dream_outside"), "hall", "rest")).toBe("dream_outside");
  });
  it("repeats use the again wording", () => {
    const g = only("noise_spike"), e = c.events.find(x => x.id === "noise_spike")!;
    fire(g, "move", "hall");
    expect(g.eventText("noise_spike")).toEqual(e.text); g.dispatch({ type: "choose", index: 0 });
    g.run.time += 24 * H; fire(g, "move", "hall");
    expect(g.eventText("noise_spike")).toEqual(e.again);
  });
  it("every event can always be closed and has both languages", () => {
    for (const e of c.events) {
      expect(e.choices[0].requires, e.id).toBeUndefined();
      expect(e.text.zh && e.text.en, e.id).toBeTruthy();
    }
    expect(c.events.length).toBeGreaterThanOrEqual(15);
  });
  it("old saves without cooldown state load", () => {
    const g = Game.newRun(c, newMeta(), 8, []); const r = JSON.parse(JSON.stringify(g.run)); delete r.eventLast;
    expect(runDefaults(r).eventLast).toEqual({});
  });
});
