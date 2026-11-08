import { describe, expect, it } from "vitest";
import { Game, type Command } from "../src/core/game";
import { draw } from "../src/core/rng";
import { ck } from "../src/core/types";
import { newMeta } from "../src/state/types";
import { makePack, packCode } from "../src/systems/symbol-lock";
import { exportSave, importSave } from "../src/state/save";
import { loadContent } from "../tools/content-plugin";
const c = loadContent();
function setup(bought: string[] = []) {
  const m = newMeta(); m.runs = 1; const g = Game.newRun(c, m, 22, bought);
  g.run.lockedPack = makePack(c.puzzles[0], g.run, m, g.run.pos, () => draw(g.run.rng, "puzzles"));
  g.run.packPlan = "none"; return g;
}
function reload(g: Game) { const s = importSave(exportSave(g.meta, g.save())); return new Game(c, s.meta, s.run!); }

describe("fallen backpack actions", () => {
  it("only the first inspected pack carries instructions, and success teaches the method", () => {
    const g = setup(); g.dispatch({ type: "packExamine" }); expect(g.run.lockedPack!.hasRuleNote).toBe(true);
    expect(g.meta.clues).not.toContain("symbol_lock_method");
    const b = reload(g); b.dispatch({ type: "packExamine" }); expect(b.run.lockedPack!.hasRuleNote).toBe(true);
    b.dispatch({ type: "packAttempt", code: packCode(b.run.lockedPack!) }); expect(b.meta.clues).toContain("symbol_lock_method");
    b.dispatch({ type: "packAttempt", code: packCode(b.run.lockedPack!) }); expect(b.meta.clues.filter(x => x === "symbol_lock_method")).toHaveLength(1);
    const next = Game.newRun(c, b.meta, 23, []); next.run.lockedPack = makePack(c.puzzles[0], next.run, b.meta, next.run.pos, () => draw(next.run.rng, "puzzles"));
    next.dispatch({ type: "packExamine" }); expect(next.run.lockedPack!.hasRuleNote).toBe(false);
  });
  it("does not consume first instructions until the pack is actually inspected", () => {
    const g = setup(); expect(g.meta.symbolLock.ruleNoteSeen).toBe(false);
    g.dispatch({ type: "packExamine" }); expect(g.meta.symbolLock.ruleNoteSeen).toBe(true);
    const next = Game.newRun(c, g.meta, 24, []); next.run.lockedPack = makePack(c.puzzles[0], next.run, g.meta, next.run.pos, () => draw(next.run.rng, "puzzles"));
    next.dispatch({ type: "packExamine" }); expect(next.run.lockedPack!.hasRuleNote).toBe(false);
    expect(next.meta.clues).not.toContain("symbol_lock_method");
  });
  it("charges attempts, jams on three failures, and resumes after loosening", () => {
    const g = setup(), code = packCode(g.run.lockedPack!), wrong = code.map((n, k) => k ? n : (n + 1) % 10);
    for (let k = 0; k < 3; k++) { const out = g.dispatch({ type: "packAttempt", code: wrong }); expect(out.minutes).toBe(2); expect(out.caption?.en).toMatch(/holds/); }
    expect(g.run.lockedPack!.jammed).toBe(true);
    expect(g.dispatch({ type: "packAttempt", code }).minutes).toBe(0);
    const b = reload(g); expect(b.run.lockedPack!.failures).toBe(3); expect(b.dispatch({ type: "packUnjam" }).minutes).toBe(10);
    expect(b.dispatch({ type: "packAttempt", code }).minutes).toBe(2); expect(b.run.lockedPack!.openedBy).toBe("code");
  });
  it("allows prying a jammed lock and learns the method", () => {
    const g = setup(); expect(g.dispatch({ type: "packForce" }).say[0].en).toMatch(/crowbar/);
    g.run.inv.push({ key: "bar", id: "crowbar" }); g.run.lockedPack!.jammed = true;
    expect(g.dispatch({ type: "packForce" }).minutes).toBe(15); expect(g.run.lockedPack!.openedBy).toBe("crowbar"); expect(g.meta.clues).toContain("symbol_lock_method");
    expect(g.dispatch({ type: "packForce" }).minutes).toBe(0); expect(g.has("crowbar")).toBe(true);
  });
  it("leaves overweight loot in place and never duplicates taken loot", () => {
    const g = setup(["crowbar", "crowbar"]), p = g.run.lockedPack!, key = p.items[0].key;
    g.dispatch({ type: "packForce" }); expect(g.dispatch({ type: "packTake", key }).say[0].en).toMatch(/remain/); expect(p.items.some(x => x.key === key)).toBe(true);
    g.run.inv.pop(); g.dispatch({ type: "packTake", key }); g.dispatch({ type: "packTake", key });
    expect(g.run.inv.filter(x => x.key === key)).toHaveLength(1); expect(p.items.some(x => x.key === key)).toBe(false);
    const b = reload(g); expect(b.run.lockedPack!.items.some(x => x.key === key)).toBe(false);
  });
  it("does not open, learn or give loot after an action kills the player", () => {
    const g = setup(["crowbar"]); g.run.stats.water = 0; g.run.stats.health = .01;
    g.dispatch({ type: "packForce" }); expect(g.run.ended).not.toBeNull(); expect(g.run.lockedPack!.openedBy).toBeNull(); expect(g.meta.clues).not.toContain("symbol_lock_method");
  });
  it("validates location, closed packs, and malformed codes before mutation", () => {
    const g = setup(), p = g.run.lockedPack!, before = JSON.stringify(p);
    g.dispatch({ type: "packTake", key: p.items[0].key }); g.dispatch({ type: "packAttempt", code: [1, 2] }); expect(JSON.stringify(p)).toBe(before);
    p.pos = { i: 100, j: 100 }; const time = g.run.time;
    const cmds: Command[] = [{ type: "packExamine" }, { type: "packMarks" }, { type: "packAttempt", code: packCode(p) }, { type: "packForce" }, { type: "packUnjam" }, { type: "packTake", key: p.items[0].key }];
    for (const cmd of cmds) expect(g.dispatch(cmd).minutes).toBe(0); expect(g.run.time).toBe(time); expect(p.seen).toBe(false);
  });
  it("charges examining marks only once, keeps the pack when cells are evicted, and stores no dials", () => {
    const g = setup(); expect(g.dispatch({ type: "packMarks" }).minutes).toBe(2); expect(g.dispatch({ type: "packMarks" }).minutes).toBe(0);
    const original = structuredClone(g.run.lockedPack); g.world.ensureAround(100, 100); expect(g.world.cells.has(ck(0, 0))).toBe(false);
    const b = reload(g); expect(b.run.lockedPack).toEqual(original); expect(b.run.lockedPack).not.toHaveProperty("code"); expect(b.run.lockedPack).not.toHaveProperty("dials");
  });
});
