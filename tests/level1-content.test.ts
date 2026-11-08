import { expect, it } from "vitest";
import { Level, Reward, checkRefs } from "../tools/content-schema";
import { loadContent } from "../tools/content-plugin";
it("validates warehouse language, layout, probabilities and supply references", () => {
  const c = loadContent(), level = c.levels[0];
  expect(Level.safeParse({ ...level, arrival: { zh: "水泥。" } }).success).toBe(false);
  expect(Level.safeParse({ ...level, layout: { chunkSize: 8, baseMin: 12, baseMax: 8 } }).success).toBe(false);
  expect(Level.safeParse({ ...level, supplies: { ...level.supplies, waterChance: 2 } }).success).toBe(false);
  const bad = structuredClone(c); bad.levels[0].supplies.base[0].item = "missing";
  expect(checkRefs(bad)).toContain("level-1: unknown item missing");
  expect(Reward.safeParse({ ...c.rewards[0], survivalMultiplier: -1 }).success).toBe(false);
});
