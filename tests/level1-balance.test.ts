import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { Level1 } from "../src/world/level1";
import { newMeta } from "../src/state/types";
import { exportSave, importSave } from "../src/state/save";
import { warehouseSurvival } from "../src/systems/rewards";
import { loadContent } from "../tools/content-plugin";
const c = loadContent();
describe("bounded warehouse supplies and rewards", () => {
  it("cannot generate more than five caches by walking further, reloading, or revisiting", () => {
    const w = new Level1(101, c.levels[0]); const initial = [...w.crates.keys()];
    for (const p of [[0,0],[30,30],[-30,-30],[100,100]]) w.ensureAround(p[0],p[1]);
    const loaded = new Level1(101, c.levels[0], structuredClone(w.toData())); loaded.ensureAround(200,200);
    expect([...loaded.crates.keys()]).toEqual(initial);
    expect(initial.filter(id=>id.startsWith("crate:"))).toHaveLength(5);
  });
  it("preserves already-generated supplies in an older warehouse save", () => {
    const w = new Level1(101, c.levels[0]), data = w.toData();
    data.crates.push({ id: "old", i: 80, j: 80, kind: "supply", examined: true, opened: true, items: [{key:"old:water",id:"almond_water"}] });
    const loaded = new Level1(101, c.levels[0], data); loaded.ensureAround(80,80);
    expect(loaded.crates.get("old")!.items[0].key).toBe("old:water");
  });
  it("exhausts searches without refreshing them on reload or in an unexplored cell", () => {
    const g = Game.newRun(c, newMeta(), 101, []); g.devJump("level1"); if (g.world.level !== "level-1") throw new Error();
    const w=g.world; g.run.l1!.searches = w.rules.supplies.searchLimit; g.run.l1!.power.nextAt=g.run.time+99999;
    const [i,j]=w.global(w.distance-1,0); g.run.pos={i,j,d:0};w.ensureAround(i,j);
    g.dispatch({type:"search"}); expect(g.cellHere().items).toEqual([]);
    const s=importSave(exportSave(g.meta,g.save())); const loaded=new Game(c,s.meta,s.run!);
    expect(loaded.run.l1!.searches).toBeGreaterThanOrEqual(w.rules.supplies.searchLimit);
  });
  it("shows a concrete foraging destination after meeting the elder, and admits exhaustion", () => {
    const g = Game.newRun(c,newMeta(),101,[]);g.devJump("level1");g.devJump("alpha");g.dispatch({type:"elderTalk"});
    expect(g.dispatch({type:"readNotice"}).say[1].en).toContain("Nearest uncollected marking");
    if(g.world.level !== "level-1") throw new Error();
    for(const crate of g.world.crates.values()) {crate.opened=true;crate.items=[];}
    expect(g.dispatch({type:"readNotice"}).say[1]).toEqual(g.elder.text.exhausted);
  });
  it("uses day/days and caps Level 1 time without counting it again as Level 0", () => {
    const g=Game.newRun(c,newMeta(),101,[]);g.devJump("level1");
    for(const days of [1,2]) {
      g.run.l1!.enteredAt=days*1440;g.run.time=g.run.l1!.enteredAt+1440*10000;
      const scores=warehouseSurvival(g.run,c); expect(scores[0].label.en).toBe(`Survived ${days} day${days===1?"":"s"} in Level 0`);
      expect(scores[0].pts).toBe(days*10);expect(scores.at(-1)!.pts).toBe(c.rewards[0].survivalCap);
    }
  });
});
