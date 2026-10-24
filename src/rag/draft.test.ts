import { describe, expect, test } from "vitest";
import { findPreset } from "../campaign/presets.js";
import { type ChatModelFactory, buildCampaignPrompt, draftCampaignCopy } from "./draft.js";

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
    const result = await draftCampaignCopy(spec, audience, { apiKey: undefined, model: "deepseek-chat", maxRetries: 2, timeoutMs: 20_000 });

    expect(result.status).toBe("dry-run");
    expect(result.prompt).toContain("Seafood Festival for high spenders");
    expect(result.copy).toBeNull();
  });
});

describe("draftCampaignCopy with a DeepSeek key", () => {
  const deepseek = { apiKey: "test-key", model: "deepseek-chat", maxRetries: 2, timeoutMs: 20_000 };

  test("caps retries and time per attempt on the DeepSeek client", async () => {
    const created: unknown[] = [];
    const createModel: ChatModelFactory = (options) => {
      created.push(options);
      return () => "Subject: Seafood Festival";
    };

    await draftCampaignCopy(spec, audience, deepseek, createModel);

    expect(created).toEqual([expect.objectContaining({ maxRetries: 2, timeout: 20_000 })]);
  });

  test("returns the drafted copy when DeepSeek answers", async () => {
    const result = await draftCampaignCopy(spec, audience, deepseek, () => () => "Subject: Seafood Festival");

    expect(result).toMatchObject({ status: "drafted", copy: "Subject: Seafood Festival", note: null });
  });

  test("fails soft: keeps the prompt and explains why when DeepSeek fails", async () => {
    const failing: ChatModelFactory = () => () => {
      throw new Error("Request timed out.");
    };

    const result = await draftCampaignCopy(spec, audience, deepseek, failing);

    expect(result.status).toBe("unavailable");
    expect(result.copy).toBeNull();
    expect(result.prompt).toContain("Seafood Festival for high spenders");
    expect(result.note).toBe("Draft unavailable: DeepSeek failed after up to 3 attempts (Request timed out.).");
  });
});
