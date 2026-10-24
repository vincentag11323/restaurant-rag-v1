import { beforeAll, describe, expect, test } from "vitest";
import { selectAudience } from "../campaign/audience.js";
import { PRESET_CAMPAIGNS, findPreset } from "../campaign/presets.js";
import { loadConfig } from "../config.js";
import { loadGuestProfiles } from "../domain/load-profiles.js";
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

  test("ranks seafood lovers first for the seafood festival", async () => {
    const result = await findRecipients(store, profiles, findPreset("seafood-festival-high-spenders"));

    expect(["Sarah Tan", "Lucas Martin", "Aisha Rahman"]).toContain(result.recipients[0]?.name);
    const distances = result.recipients.map((r) => r.distance);
    expect(distances).toEqual(distances.toSorted((a, b) => a - b));
  });

  test("reports guests excluded for allergies and why each recipient was chosen", async () => {
    const result = await findRecipients(store, profiles, findPreset("seafood-festival-high-spenders"));

    expect(result.excludedForAllergy.map((g) => g.name).sort()).toEqual([
      "Daniel Wright", "Emma Schultz", "Hannah Kim", "Mei Lin Wong", "Olivia Hart",
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
