import type { VectorStore } from "@langchain/core/vectorstores";
import { campaignConditions, selectAudience } from "../campaign/audience.js";
import { matchesAll, toChromaWhere, toMetadata } from "../campaign/conditions.js";
import { assertAllergySafe } from "../campaign/safety.js";
import type { CampaignSpec } from "../campaign/spec.js";
import type { GuestProfile } from "../domain/guest-profile.js";
import type { Allergen } from "../domain/menu.js";

export type GuestProfileStore = Pick<VectorStore, "similaritySearchWithScore">;

export interface Recipient {
  readonly guestId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  /** Cosine distance between the campaign query and the guest profile (lower = closer). */
  readonly distance: number;
  readonly reasons: readonly string[];
}

export interface ExcludedGuest {
  readonly guestId: string;
  readonly name: string;
  readonly allergies: readonly Allergen[];
}

export interface RetrievalResult {
  readonly recipients: readonly Recipient[];
  readonly excludedForAllergy: readonly ExcludedGuest[];
  readonly rules: readonly string[];
}

export class IndexOutOfDateError extends Error {
  override readonly name = "IndexOutOfDateError";
}

const staleIndex = (detail: string) =>
  new IndexOutOfDateError(`Vector index is out of date (${detail}). Run \`npm run ingest\` to rebuild it.`);

/**
 * Hybrid retrieval: Chroma applies the hard rules (incl. allergy exclusion) as a metadata
 * filter and ranks by semantic similarity; every hit is then re-checked against the source
 * profiles, so a stale or wrong index can never put an allergic guest on the list.
 */
export async function findRecipients(
  store: GuestProfileStore,
  profiles: readonly GuestProfile[],
  spec: CampaignSpec,
): Promise<RetrievalResult> {
  const conditions = campaignConditions(spec);
  const rules = [...conditions.audience, ...conditions.allergy];
  const hits = await store.similaritySearchWithScore(spec.query, spec.limit, toChromaWhere(rules));

  const byId = new Map(profiles.map((p) => [p.guestId, p]));
  const matched = hits.map(([doc, distance]) => {
    const profile = byId.get(String(doc.metadata.guestId));
    if (!profile) throw staleIndex(`unknown guest ${String(doc.metadata.guestId)}`);
    return { profile, distance };
  });

  const failing = matched.filter((m) => !matchesAll(toMetadata(m.profile), rules));
  if (failing.length > 0) throw staleIndex(`${failing.length} hit(s) no longer match the campaign rules`);
  assertAllergySafe(
    matched.map((m) => m.profile),
    spec.promotedItems,
  );

  const expected = selectAudience(profiles, spec);
  const expectedCount = Math.min(spec.limit, expected.audience.length);
  if (matched.length < expectedCount) throw staleIndex(`expected ${expectedCount} guests, got ${matched.length}`);

  const reasons = rules.map((c) => c.label);
  return {
    recipients: matched
      .toSorted((a, b) => a.distance - b.distance)
      .map(({ profile: p, distance }) => ({
        guestId: p.guestId,
        name: p.name,
        email: p.email,
        phone: p.phone,
        distance: Number(distance.toFixed(4)),
        reasons,
      })),
    excludedForAllergy: expected.excludedForAllergy.map((p) => ({ guestId: p.guestId, name: p.name, allergies: p.allergies })),
    rules: reasons,
  };
}
