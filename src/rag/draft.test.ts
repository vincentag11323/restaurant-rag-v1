import { describe, expect, test } from "vitest";
import { findPreset } from "../campaign/presets.js";
import { buildCampaignPrompt, draftCampaignCopy } from "./draft.js";

const spec = findPreset("seafood-festival-high-spenders");
const audience = { size: 8, reasons: ["spends $100+ per visit", "no seafood allergy"] };

describe("buildCampaignPrompt", () => {
  test("includes the campaign, promoted dishes with menu prices, and audience size", async () => {
    const prompt = await buildCampaignPrompt(spec, audience);

    expect(prompt).toContain("Seafood Festival for high spenders");
    expect(prompt).toContain("Barramundi ($34.00)");
    expect(prompt).toContain("Grilled Prawn Salad ($26.00)");
    expect(prompt).toContain("8 guests");
    expect(prompt).toContain("{{first_name}}");
  });

  test("never sends guest names, contacts or allergy details to the LLM", async () => {
    const prompt = await buildCampaignPrompt(spec, audience);

    expect(prompt).not.toMatch(/@|555|Sarah|Olivia|allergy/i);
  });
});

describe("draftCampaignCopy", () => {
  test("returns a dry run with the exact prompt when no DeepSeek key is configured", async () => {
    const result = await draftCampaignCopy(spec, audience, { apiKey: undefined, model: "deepseek-chat" });

    expect(result.status).toBe("dry-run");
    expect(result.prompt).toContain("Seafood Festival for high spenders");
    expect(result.copy).toBeNull();
  });
});
