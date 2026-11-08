import { describe, expect, it } from "vitest";
import { loadContent } from "../tools/content-plugin";
import { Game } from "../src/core/game";
import { newMeta, type MapCell, type RunState } from "../src/state/types";
import { exportSave, importSave, loadRun, persist, wipe } from "../src/state/save";
import { mapEdge, mapOpacity, messyWalls, NOTEBOOK_COOLDOWN, notebookReadGain, recordNotebook, recordNotebookDoor } from "../src/systems/notebook";
import { tick } from "../src/systems/survival";
import { edgeKey, type Edge } from "../src/world/level0";

const c = loadContent();
const make = (items = ["notebook", "flashlight"]) => Game.newRun(c, newMeta(), 2024, items);
function corridor(g: Game) {
  for (let j = 0; j >= -4; j--) g.level0.edges.set(edgeKey(0, j, 0), "open");
  g.run.map = {}; recordNotebook(g.run, g.level0, true);
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("notebook observations", () => {
  it("records nothing without a notebook, and does not reconstruct the route on pickup", () => {
    const g = make([]);
    g.level0.edges.set(edgeKey(0, -1, 0), "open");
    g.dispatch({ type: "move", d: 0 });
    expect(g.run.map).toEqual({});
    g.cellHere().items.push({ id: "notebook", key: "book", x: 0, z: 0 });
    g.dispatch({ type: "pickup", key: "book" });
    expect(g.run.map["0,-1"].visited).toBe(true);
    expect(g.run.map["0,0"]).toBeUndefined();
  });

  it("records only the current cell and at most three cells straight ahead", () => {
    const g = make(); corridor(g);
    expect(Object.keys(g.run.map)).toEqual(["0,0", "0,-1", "0,-2", "0,-3"]);
    expect(g.run.map["0,0"].visited).toBe(true);
    expect(g.run.map["0,-1"].visited).toBe(false);
    expect(g.run.map["0,-1"].walls).toHaveLength(4);
  });

  it.each(["wall", "door-wood", "door-metal", "door-manila", "flicker", "fakeflicker"] as Edge[])("does not see through %s", edge => {
    const g = make(); g.level0.edges.set(edgeKey(0, -1, 0), edge);
    g.run.map = {}; recordNotebook(g.run, g.level0, true);
    expect(Object.keys(g.run.map)).toEqual(["0,0", "0,-1"]);
  });

  it("does not draw ahead during a blackout without a flashlight", () => {
    const g = make(["notebook"]); g.run.outageLeft = 3;
    g.run.map = {}; recordNotebook(g.run, g.level0, true);
    expect(Object.keys(g.run.map)).toEqual(["0,0"]);
    expect(g.run.map["0,0"].walls).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(g.run.map["0,0"].zone).toBe("unknown"); expect(g.run.map["0,0"].visited).toBe(true);
  });

  it("records only a visit in a dark zone, without revealing its walls or zone", () => {
    const g = make(["notebook"]);
    let dark: [number, number] | undefined;
    for (let i = -30; i <= 30 && !dark; i++) for (let j = -30; j <= 30; j++) if (g.level0.zone(i, j) === "dark") { dark = [i, j]; break; }
    expect(dark).toBeDefined(); const [i, j] = dark!;
    g.run.pos = { i, j, d: 0 }; g.level0.ensureAround(i, j); g.run.map = {}; g.run.stats.sanity = 20;
    recordNotebook(g.run, g.level0, true);
    const cells = Object.values(g.run.map);
    expect(cells).toHaveLength(1); expect(cells[0].zone).toBe("unknown");
    expect(cells[0].walls).toEqual(["unknown", "unknown", "unknown", "unknown"]);
  });

  it("retains older visible drawings and their age when revisiting in total darkness", () => {
    const g = make(["notebook"]), before = copy(g.run.map["0,-1"]);
    g.run.time = 60; g.run.pos.j = -1; g.run.outageLeft = 3;
    g.level0.edges.set(edgeKey(0, -1, 1), "door-metal");
    expect(recordNotebook(g.run, g.level0, true)).toBe(false);
    expect(g.run.map["0,-1"]).toEqual({ ...before, visited: true });
  });

  it("fills unseen details after the light returns without inventing a discrepancy", () => {
    const g = make(["notebook"]); g.run.outageLeft = 3; g.run.map = {};
    recordNotebook(g.run, g.level0, true);
    g.level0.edges.set(edgeKey(0, 0, 1), "door-wood-open");
    recordNotebookDoor(g.run, g.level0, edgeKey(0, 0, 1));
    expect(g.run.map["0,0"].walls).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    g.run.time = 30; g.run.outageLeft = 0;
    expect(recordNotebook(g.run, g.level0)).toBe(false);
    expect(g.run.map["0,0"].walls).not.toContain("unknown"); expect(g.run.map["0,0"].zone).toBe("hall");
    expect(g.run.map["0,0"].t).toBe(30);
  });

  it("keeps snapshots after a shift and redraws only on entry, with a discrepancy", () => {
    const g = make();
    g.level0.edges.set(edgeKey(0, -1, 1), "wall"); corridor(g);
    const before = copy(g.run.map), ver = g.level0.cells.get("0,-1")!.ver;
    expect(g.level0.shiftUnseen(new Set(["0,0"]))).toBeGreaterThan(0);
    expect(g.level0.cells.get("0,-1")!.ver).toBeGreaterThan(ver);
    g.level0.edges.set(edgeKey(0, -1, 1), "open");
    recordNotebook(g.run, g.level0);
    expect(g.run.map).toEqual(before);
    const out = g.dispatch({ type: "move", d: 0 });
    expect(out.say.some(t => t.en === "This isn't what you drew.")).toBe(true);
    expect(g.run.map["0,-1"].visited).toBe(true);
    expect(g.run.map["0,-1"].ver).toBe(g.cellHere().ver);
    expect(g.run.map["0,-1"].walls[1]).toBe("open");
    expect(g.run.map["0,-2"]).toEqual(before["0,-2"]);
  });

  it("detects a changed shared edge even if the cell's own version is unchanged", () => {
    const g = make(); g.level0.edges.set(edgeKey(0, -1, 1), "wall"); corridor(g);
    const ver = g.run.map["0,-1"].ver;
    g.level0.edges.set(edgeKey(0, -1, 1), "open");
    const out = g.dispatch({ type: "move", d: 0 });
    expect(g.run.map["0,-1"].ver).toBe(ver);
    expect(out.say.some(t => t.zh === "這裡跟你畫的不一樣。")).toBe(true);
  });

  it("stores real and fake flickering walls as completely identical map data", () => {
    const draw = (edge: Edge) => {
      const g = make(); g.run.stats.sanity = 20; g.run.map = {};
      g.level0.edges.set(edgeKey(0, 0, 0), edge);
      recordNotebook(g.run, g.level0, true);
      return g.run.map;
    };
    expect(draw("flicker")).toEqual(draw("fakeflicker"));
    expect(draw("flicker")["0,0"].walls[0]).toBe("flicker");
    expect(JSON.stringify(draw("fakeflicker"))).not.toContain("fakeflicker");
  });

  it("erases door materials and Manila wall identity from observations", () => {
    expect(["door-wood", "door-metal", "door-manila"].map(t => mapEdge(t as Edge))).toEqual(["door", "door", "door"]);
    expect(["door-wood-open", "door-metal-open", "door-manila-open"].map(t => mapEdge(t as Edge))).toEqual(["door-open", "door-open", "door-open"]);
    expect(mapEdge("mwall")).toBe("wall");
  });

  it("only updates the observed door when it is opened, retaining the age of the drawing", () => {
    const g = make(); g.level0.edges.set(edgeKey(0, 0, 1), "door-wood");
    g.run.map = {}; recordNotebook(g.run, g.level0, true);
    const before = copy(g.run.map["0,0"]);
    g.dispatch({ type: "door", edge: edgeKey(0, 0, 1) });
    expect(g.run.map["0,0"]).toEqual({ ...before, walls: before.walls.map((w, d) => d === 1 ? "door-open" : w) });
  });

  it("stops recording after the notebook is put down", () => {
    const g = make(); corridor(g); const before = copy(g.run.map);
    g.dispatch({ type: "drop", key: g.run.inv.find(x => x.id === "notebook")!.key });
    g.dispatch({ type: "move", d: 0 });
    expect(g.run.map).toEqual(before);
  });

  it("keeps recording deterministic without consuming any random stream", () => {
    const a = make(), b = make(["flashlight"]);
    a.run.stats.sanity = b.run.stats.sanity = 20;
    for (let i = 0; i < 12; i++) {
      a.dispatch({ type: "turn", dir: 1 }); b.dispatch({ type: "turn", dir: 1 });
    }
    expect(a.run.rng).toEqual(b.run.rng);
    const before = copy(a.run.map);
    const restored = new Game(c, newMeta(), copy(a.save()));
    expect(restored.run.map).toEqual(before);
    const next = make(); next.run.stats.sanity = 20;
    for (let i = 0; i < 12; i++) next.dispatch({ type: "turn", dir: 1 });
    expect(next.run.map).toEqual(a.run.map);
  });

  it("fades with game time and remains faintly legible", () => {
    expect(mapOpacity(0, 0)).toBe(1);
    expect(mapOpacity(480, 0)).toBe(.625);
    expect(mapOpacity(100000, 0)).toBeGreaterThanOrEqual(.25);
  });
});

describe("messy handwriting", () => {
  it("deterministically swaps at most one open/wall edge about 15% of the time", () => {
    const walls: MapCell["walls"] = ["open", "wall", "door", "flicker"];
    let wrong = 0;
    for (let i = 0; i < 1000; i++) {
      const drawn = messyWalls(99, i, 3, 0, walls);
      const differences = drawn.filter((w, d) => w !== walls[d]).length;
      expect(differences).toBeLessThanOrEqual(1);
      expect(drawn[2]).toBe("door"); expect(drawn[3]).toBe("flicker");
      expect(messyWalls(99, i, 3, 0, drawn)).toEqual(walls);
      expect(messyWalls(99, i, 3, 0, walls)).toEqual(drawn);
      wrong += differences;
    }
    expect(wrong).toBeGreaterThan(100); expect(wrong).toBeLessThan(200);
    expect(walls).toEqual(["open", "wall", "door", "flicker"]);
  });

  it("does not mistake a pen error or recovered sanity for a shifted corridor", () => {
    const g = make(); g.run.stats.sanity = 20; g.run.map = {};
    recordNotebook(g.run, g.level0, true);
    expect(g.run.map["0,0"].messy).toBe(true);
    g.run.stats.sanity = 60; g.run.time += 60;
    expect(recordNotebook(g.run, g.level0, true)).toBe(false);
    expect(g.run.map["0,0"].messy).toBe(false);
  });
});

describe("map marks and rereading", () => {
  it("edits marks only on recorded cells without advancing time, stats or RNG", () => {
    const g = make(), before = copy({ time: g.run.time, stats: g.run.stats, rng: g.run.rng, map: g.run.map });
    g.dispatch({ type: "mapMark", key: "100,100", mark: { kind: "danger" } });
    expect(g.run.mapMarks).toEqual({});
    g.dispatch({ type: "mapMark", key: "0,0", mark: { kind: "water" } });
    expect(g.run.mapMarks["0,0"]).toEqual({ kind: "water" });
    g.dispatch({ type: "mapMark", key: "0,0", mark: { kind: "custom", text: "  左轉\n" + "很".repeat(30) } });
    expect(g.run.mapMarks["0,0"]).toEqual({ kind: "custom", text: "左轉 " + "很".repeat(17) });
    expect({ time: g.run.time, stats: g.run.stats, rng: g.run.rng, map: g.run.map }).toEqual(before);
    g.dispatch({ type: "mapMark", key: "0,0", mark: null });
    expect(g.run.mapMarks).toEqual({});
  });

  it("keeps handwritten marks through shifts and redraws", () => {
    const g = make(); g.dispatch({ type: "mapMark", key: "0,0", mark: { kind: "exit" } });
    g.level0.shiftUnseen(new Set()); recordNotebook(g.run, g.level0, true);
    expect(g.run.mapMarks["0,0"]).toEqual({ kind: "exit" });
  });

  it.each([[false, 8], [true, 4]] as const)("rereads for ten minutes (mostly messy: %s, sanity restored: %s)", (mostlyMessy, gain) => {
    const g = make(); g.run.stats.sanity = 20;
    if (mostlyMessy) for (const entry of Object.values(g.run.map)) entry.messy = true;
    const expected = copy(g.run); tick(expected, 10, "idle", g.env());
    const out = g.dispatch({ type: "rereadNotebook" });
    expect(out.minutes).toBe(10); expect(g.run.stats.sanity).toBeCloseTo(expected.stats.sanity + gain);
    expect(g.run.lastNotebookRead).toBe(10);
    const again = g.dispatch({ type: "rereadNotebook" });
    expect(again.minutes).toBe(0); expect(g.run.time).toBe(10);
    g.run.time += NOTEBOOK_COOLDOWN;
    expect(g.dispatch({ type: "rereadNotebook" }).minutes).toBe(10);
  });

  it("only halves the benefit when strictly more than half the cells are messy", () => {
    const g = make(); corridor(g);
    const entries = Object.values(g.run.map); entries[0].messy = entries[1].messy = true;
    expect(notebookReadGain(g.run)).toBe(8);
    entries[2].messy = true; expect(notebookReadGain(g.run)).toBe(4);
  });

  it("cannot reread when calm, without a notebook, or during an event", () => {
    const g = make(); expect(g.dispatch({ type: "rereadNotebook" }).minutes).toBe(0);
    g.run.stats.sanity = 20; g.run.pendingEvent = "noise_spike";
    expect(g.dispatch({ type: "rereadNotebook" }).minutes).toBe(0);
    const bare = make([]); bare.run.stats.sanity = 20;
    expect(bare.dispatch({ type: "rereadNotebook" }).minutes).toBe(0);
  });
});

describe("notebook save compatibility", () => {
  it("continues old in-progress saves without changing their version", async () => {
    await wipe();
    const g = make([]); g.dispatch({ type: "move", d: 0 });
    const legacy: Partial<RunState> = copy(g.save());
    delete legacy.map; delete legacy.mapMarks; delete legacy.lastNotebookRead;
    await persist(g.meta, legacy as RunState);
    const loaded = (await loadRun())!;
    expect(loaded.v).toBe(1); expect(loaded.map).toEqual({}); expect(loaded.mapMarks).toEqual({}); expect(loaded.lastNotebookRead).toBeNull();
    expect(loaded.pos).toEqual(g.run.pos); expect(loaded.time).toBe(g.run.time);
    const imported = importSave(exportSave(g.meta, legacy as RunState)).run!;
    expect(imported).toEqual(loaded);
    expect(new Game(c, g.meta, loaded).dispatch({ type: "turn", dir: 1 }).minutes).toBe(1);
    await wipe();
  });

  it("round-trips drawings, marks and reread cooldown through storage and export", async () => {
    await wipe(); const g = make(); g.run.stats.sanity = 20;
    g.dispatch({ type: "mapMark", key: "0,0", mark: { kind: "custom", text: "先別回頭" } });
    g.dispatch({ type: "rereadNotebook" });
    const saved = copy(g.save()); await persist(g.meta, saved);
    expect(await loadRun()).toEqual(saved);
    const imported = importSave(exportSave(g.meta, saved));
    expect(imported.run).toEqual(saved);
    const restored = new Game(c, imported.meta, imported.run!);
    expect(restored.dispatch({ type: "rereadNotebook" }).minutes).toBe(0);
    await wipe();
  });
});
