import { describe, expect, it } from "vitest";
import { loadContent } from "../tools/content-plugin";
import { checkRefs, Content } from "../tools/content-schema";

describe("content", () => {
  it("loads and validates every YAML file", () => {
    const c = loadContent();
    expect(c.items.length).toBeGreaterThan(5);
    expect(c.liquids.find(l => l.id === "liquid_pain")?.deadly).toBe("death_liquid_pain");
    expect(c.sources.length).toBeGreaterThan(5);
  });
  it("rejects missing languages, unknown actions and invalid probabilities", () => {
    const c = loadContent(), missing = structuredClone(c), action = structuredClone(c), chance = structuredClone(c);
    (missing.quests[0].text.name as Partial<typeof missing.quests[0]["text"]["name"]>).en = undefined;
    expect(Content.safeParse(missing).success).toBe(false);
    Object.assign(action.dialogue[0].choices[0], { action: "teleport" }); expect(Content.safeParse(action).success).toBe(false);
    chance.puzzles[0].spawn.chance = 1.1; expect(Content.safeParse(chance).success).toBe(false);
  });
  it("checks puzzle, dialogue, clue and reward item references, and duplicate choices", () => {
    const c = structuredClone(loadContent());
    c.quests[0].pack.puzzle = "missing_puzzle"; c.quests[0].dialogue = "missing_dialogue"; c.quests[0].clues.aftermath = "missing_clue";
    c.puzzles[0].contents[0].item = "missing_item"; c.dialogue[0].choices.push(c.dialogue[0].choices[0]);
    const errors = checkRefs(c).join("\n");
    expect(errors).toContain("unknown puzzle missing_puzzle"); expect(errors).toContain("unknown dialogue missing_dialogue");
    expect(errors).toContain("unknown clue missing_clue"); expect(errors).toContain("unknown item missing_item"); expect(errors).toContain("duplicate room_person choice");
  });
});
