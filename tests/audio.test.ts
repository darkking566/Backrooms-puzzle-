import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContent } from "../tools/content-plugin";
import { Game } from "../src/core/game";
import { T, type Text } from "../src/core/types";
import { newMeta } from "../src/state/types";
import { Audio, muffle } from "../src/render/audio";
import { perceive, PIANO_CAPTION } from "../src/systems/hallucinations";

const c = loadContent();
function setup(dm = 20) {
  const g = Game.newRun(c, newMeta(), 2024, []); g.run.stats.sanity = 20;
  vi.spyOn(g.level0, "zone").mockReturnValue("hall");
  vi.spyOn(g.level0, "manilaDist").mockReturnValue(dm);
  vi.spyOn(g.level0, "redDist").mockReturnValue(99);
  const audio = new Audio(), captions: Text[] = []; audio.onCaption = t => captions.push(t);
  return { g, audio, captions };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("auditory perceptions", () => {
  it("shows warehouse captions while muted without advancing state or random streams", () => {
    const { g, audio, captions } = setup(); g.devJump("level1");
    const before = JSON.stringify(g.save()); audio.ambience(g); audio.ambience(g);
    expect(captions.some(t => t.zh.includes("水泥"))).toBe(true);
    expect(audio.on).toBe(false); expect(audio.lv.piano).toBe(0);
    expect(JSON.stringify(g.save())).toBe(before);
  });
  it("uses identical sound levels, timbre and captions for real and false piano", () => {
    const real = setup(4), fake = setup();
    fake.g.run.fakePiano = { i: 4, j: 0, until: 180, heard: true };
    real.audio.ambience(real.g); fake.audio.ambience(fake.g);
    expect(fake.audio.lv.piano).toBe(real.audio.lv.piano); expect(fake.audio.lv.cut).toBe(real.audio.lv.cut);
    expect(real.captions).toContainEqual(PIANO_CAPTION); expect(fake.captions).toContainEqual(PIANO_CAPTION);
    expect(fake.audio.on).toBe(false); // subtitles still appear with sound off
  });

  it("muffles real and false piano captions identically when hearing is damaged", () => {
    const real = setup(4), fake = setup();
    real.g.run.status.hearing_damage = fake.g.run.status.hearing_damage = 100;
    fake.g.run.fakePiano = { i: 4, j: 0, until: 180, heard: true };
    real.audio.ambience(real.g); fake.audio.ambience(fake.g);
    expect(real.captions).toEqual([muffle(PIANO_CAPTION)]);
    expect(fake.captions).toEqual(real.captions);
  });

  it("passes hallucinated sound subtitles through the same muffle path as genuine subtitles", () => {
    const { g, audio, captions } = setup(); g.run.status.hearing_damage = 100;
    g.run.halluc.pianoAfter = 1000;
    const values = [0, .5, 0];
    const out = perceive(g.run, g.level0, { action: "move", minutes: 13, previousSanity: 20, important: false }, () => values.shift() ?? .99);
    expect(out.caption).toEqual(T("〔遠處有腳步聲〕", "[Footsteps in the distance]"));
    audio.caption(out.caption!, g);
    const genuine = T("〔門軸吱呀作響〕", "[The hinges creak]"); audio.caption(genuine, g);
    expect(captions).toEqual([muffle(out.caption!), muffle(genuine)]);
    expect(captions[0]).not.toEqual(out.caption);
    expect(audio.on).toBe(false);
  });

  it("uses current hearing status for command captions without relying on an ambience update", () => {
    const { g, audio, captions } = setup();
    audio.caption(PIANO_CAPTION, g);
    g.run.status.hearing_damage = 100; audio.caption(PIANO_CAPTION, g);
    delete g.run.status.hearing_damage; audio.caption(PIANO_CAPTION, g);
    expect(captions).toEqual([PIANO_CAPTION, muffle(PIANO_CAPTION), PIANO_CAPTION]);
  });

  it("announces piano when it crosses the subtitle threshold, even after a fainter approach", () => {
    const { g, audio, captions } = setup(5.8);
    audio.ambience(g); expect(captions).not.toContainEqual(PIANO_CAPTION);
    vi.mocked(g.level0.manilaDist).mockReturnValue(5);
    audio.ambience(g); audio.ambience(g);
    expect(captions.filter(t => t.en === PIANO_CAPTION.en)).toHaveLength(1);
  });

  it("does not change run state or random counters when rendering audio repeatedly", () => {
    const { g, audio } = setup(); g.run.fakePiano = { i: 4, j: 0, until: 180, heard: true };
    const before = JSON.stringify(g.run);
    for (let k = 0; k < 5; k++) audio.ambience(g);
    expect(JSON.stringify(g.run)).toBe(before);
  });
});
