import { describe, expect, it } from "vitest";
import { loadContent } from "../tools/content-plugin";

describe("content", () => {
  it("loads and validates every YAML file", () => {
    const c = loadContent();
    expect(c.items.length).toBeGreaterThan(5);
    expect(c.liquids.find(l => l.id === "liquid_pain")?.deadly).toBe("death_liquid_pain");
    expect(c.sources.length).toBeGreaterThan(5);
  });
});
