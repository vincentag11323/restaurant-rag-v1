import { beforeAll, describe, expect, test } from "vitest";
import { selectAudience } from "../campaign/audience.js";
import { PRESET_CAMPAIGNS, findPreset } from "../campaign/presets.js";
import { loadConfig } from "../config.js";
import { loadGuestProfiles } from "../domain/load-profiles.js";
import { evaluateRanking } from "./ranking-eval.js";
import { type GuestProfileStore, findRecipients } from "./retrieve.js";
import { isChromaReachable, rebuildIndex } from "./vector-store.js";

// Runs the real pipeline (local embeddings + local Chroma) in an isolated test collection.
// Start Chroma first: `npm run chroma`. Skipped when Chroma is not reachable.
const config = loadConfig({ ...process.env, CHROMA_COLLECTION: "guest_profiles_test" });
const profiles = loadGuestProfiles(config.invoicesCsv);
const chromaUp = await isChromaReachable(config);
const names = (list: readonly { name: string }[]) => list.map((p) => p.name).sort();
const EMBEDDING_TIMEOUT_MS = 180_000;

describe.skipIf(!chromaUp)("RAG retrieval against local Chroma", () => {
  let store: GuestProfileStore;

  beforeAll(async () => {
    store = await rebuildIndex(config, profiles);
  }, EMBEDDING_TIMEOUT_MS);

  test.each(PRESET_CAMPAIGNS.map((c) => [c.id, c] as const))(
    "%s: Chroma returns exactly the audience the rules allow",
    async (_id, spec) => {
      const result = await findRecipients(store, profiles, spec);

      expect(names(result.recipients)).toEqual(names(selectAudience(profiles, spec).audience));
    },
  );

  test("ranks seafood lovers first for the seafood festival, ordered by hybrid score", async () => {
    const result = await findRecipients(store, profiles, findPreset("seafood-festival-high-spenders"));

    expect(result.recipients.slice(0, 2).map((r) => r.name)).toEqual(["Sarah Tan", "Lucas Martin"]);
    const scores = result.recipients.map((r) => r.score);
    expect(scores).toEqual(scores.toSorted((a, b) => b - a));
    expect(result.ranking.intentSignals).toEqual(["likes seafood (Barramundi)"]);
  });

  test("finding: ranks the biggest event hosts first (pure semantics put a 32-person host first)", async () => {
    const result = await findRecipients(store, profiles, findPreset("vip-event-hosts-room-package"));

    expect(result.recipients.slice(0, 2).map((r) => r.name).sort()).toEqual(["Hannah Kim", "Olivia Hart"]);
  });

  test("finding: ranks 100% happy-hour regulars above 50% ones (pure semantics had it backwards)", async () => {
    const result = await findRecipients(store, profiles, findPreset("happy-hour-regulars"));
    const share = (name: string) => profiles.find((p) => p.name === name)?.happyHourShare ?? 0;

    const shares = result.recipients.map((r) => share(r.name));
    expect(shares).toEqual(shares.toSorted((a, b) => b - a));
  });

  test("traces every pipeline stage in order", async () => {
    const result = await findRecipients(store, profiles, findPreset("seafood-gala-poultry-event-hosts"));

    expect(result.trace.map((t) => t.step)).toEqual(["plan", "search", "verify", "rerank"]);
    expect(result.trace[1]?.detail).toBe("skipped: nobody eligible");
  });

  // Known-hard cases, documented in rag-tuning-findings.txt (F6, F8). They are pinned at their
  // current score so they cannot silently get worse; every other campaign must stay high.
  const KNOWN_HARD: Readonly<Record<string, number>> = {
    "christmas-banquet-event-hosts": 0.5, // F6: mixed intent (party size vs steak/fish)
    "budget-small-parties-lunch": -0.3, // F8: semantics favour snack-and-drink chillers
  };

  test("ranking quality stays above the tuned baseline (regression guard)", async () => {
    const report = await evaluateRanking(store, profiles);
    const regular = report.rows.filter((r) => !(r.campaignId in KNOWN_HARD));
    const mean = regular.reduce((sum, r) => sum + r.spearman, 0) / regular.length;

    expect(mean).toBeGreaterThanOrEqual(0.8);
    expect(regular.filter((r) => r.spearman < 0)).toEqual([]);
    for (const row of report.rows.filter((r) => r.campaignId in KNOWN_HARD)) {
      expect(row.spearman, row.campaignId).toBeGreaterThanOrEqual(KNOWN_HARD[row.campaignId] ?? 0);
    }
  }, EMBEDDING_TIMEOUT_MS);

  test("reports guests excluded for allergies and why each recipient was chosen", async () => {
    const result = await findRecipients(store, profiles, findPreset("seafood-festival-high-spenders"));

    expect(result.excludedForAllergy.map((g) => g.name).sort()).toEqual([
      "Daniel Wright", "Emma Schultz", "Hannah Kim", "Marco Silva", "Mei Lin Wong", "Olivia Hart",
    ]);
    expect(result.recipients[0]?.reasons).toEqual(["spends $100+ per visit", "no seafood allergy"]);
  });

  test("respects the campaign limit, keeping the closest matches", async () => {
    const spec = { ...findPreset("red-meat-fans-steak-night"), limit: 2 };

    const result = await findRecipients(store, profiles, spec);

    expect(result.recipients).toHaveLength(2);
  });

  test("fails loudly instead of returning a partial audience when the index is stale", async () => {
    const staleStore = await rebuildIndex(
      { ...config, chromaCollection: "guest_profiles_test_stale" },
      profiles.filter((p) => p.name !== "Sarah Tan"),
    );

    await expect(findRecipients(staleStore, profiles, findPreset("seafood-fans-barramundi"))).rejects.toThrow(
      /out of date.*npm run ingest/,
    );
  }, EMBEDDING_TIMEOUT_MS);
});
