import { describe, expect, test } from "vitest";
import { selectAudience } from "../campaign/audience.js";
import type { CampaignSpec } from "../campaign/spec.js";
import { loadInvoicesAndProfiles } from "../domain/load-profiles.js";
import type { CampaignReport, CampaignRunner } from "../rag/campaign-runner.js";
import { createAssistant } from "./assistant.js";

// Fake retrieval: returns everyone the rules allow, in name order (no Chroma needed),
// so these tests check sorting and limits, not semantic ranking.
const { invoices, profiles } = loadInvoicesAndProfiles("data/mock/invoices.csv");
const runner: CampaignRunner = {
  async run(spec: CampaignSpec) {
    const { audience, excludedForAllergy } = selectAudience(profiles, spec);
    const recipients = audience.map((p) => ({ guestId: p.guestId, name: p.name, email: p.email, phone: p.phone, distance: 0, score: 0, semantic: 0, intent: 0, reasons: [] }));
    const excluded = excludedForAllergy.map((p) => ({ guestId: p.guestId, name: p.name, allergies: p.allergies }));
    return {
      campaign: spec,
      rules: [],
      ranking: { semanticWeight: 0.5, intentSignals: [] },
      audience: { count: recipients.length, recipients },
      excludedForAllergy: { count: excluded.length, guests: excluded },
      draft: { status: "dry-run", prompt: "", copy: null, note: null },
      trace: [],
    } satisfies CampaignReport;
  },
};
const assistant = createAssistant({ runner, profiles, invoices });

async function namesFor(prompt: string) {
  const reply = await assistant.reply(prompt);
  if (reply.kind !== "list" && reply.kind !== "campaign") throw new Error(`unexpected ${reply.kind}`);
  return { names: reply.report?.audience.recipients.map((r) => r.name) ?? [], reply };
}

describe("assistant sorting and limits", () => {
  test("top 3 biggest spenders, most first", async () => {
    const { names, reply } = await namesFor("top 3 biggest spenders");

    expect(names).toEqual(["Olivia Hart", "Hannah Kim", "Grace O'Brien"]);
    expect(reply.kind === "list" && reply.ordering).toBe("Sorted by total spend, most first · showing 3 of 20");
  });

  test("bottom 3 by total spend, least first", async () => {
    expect((await namesFor("bottom 3 by total spend")).names).toEqual(["James Okafor", "Ben Carter", "Raj Patel"]);
  });

  test("filters, then sorts, then limits", async () => {
    expect((await namesFor("show 2 seafood fans who spend the least")).names).toEqual(["Raj Patel", "Sarah Tan"]);
  });

  test("ranks by visits, least to most", async () => {
    const { names } = await namesFor("rank guests by visits from least to most");
    const visits = names.map((n) => profiles.find((p) => p.name === n)?.visits ?? 0);

    expect(names).toHaveLength(20);
    expect(visits).toEqual(visits.toSorted((a, b) => a - b));
  });

  test("a campaign for the top 3 spenders is planned for exactly those 3", async () => {
    const { names, reply } = await namesFor("campaign for the top 3 spenders");

    expect(names.toSorted()).toEqual(["Grace O'Brien", "Hannah Kim", "Olivia Hart"]);
    expect(reply.kind === "campaign" && reply.proposal?.evidence[0]).toBe("3 guest(s) match your request.");
  });
});

describe("assistant: 'who does the most X' leaves out guests with none of X", () => {
  test("who orders the most seafood lists only guests who ordered seafood", async () => {
    const { names } = await namesFor("who orders the most seafood");

    expect(names[0]).toBe("Lucas Martin");
    expect(names.every((n) => (profiles.find((p) => p.name === n)?.mainsByGroup.seafood ?? 0) > 0)).toBe(true);
  });

  test("who orders the least seafood still includes guests with none", async () => {
    const { names } = await namesFor("who orders the least seafood");

    expect(names).toHaveLength(20);
  });
});
