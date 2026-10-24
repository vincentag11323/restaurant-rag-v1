import type { GuestProfile } from "../domain/guest-profile.js";
import { allergensOf } from "../domain/menu.js";
import { type Condition, allergyConditions, audienceConditions, matchesAll, toMetadata } from "./conditions.js";
import { assertAllergySafe } from "./safety.js";
import type { CampaignSpec } from "./spec.js";

export interface CampaignConditions {
  readonly audience: readonly Condition[];
  readonly allergy: readonly Condition[];
}

export interface AudienceSelection {
  readonly audience: readonly GuestProfile[];
  /** Guests who match the audience rules but are allergic to a promoted dish. */
  readonly excludedForAllergy: readonly GuestProfile[];
}

export function campaignConditions(spec: CampaignSpec): CampaignConditions {
  return {
    audience: audienceConditions(spec.audience),
    allergy: allergyConditions(allergensOf(spec.promotedItems)),
  };
}

/** Deterministic, in-memory audience selection from source profiles (no vector store involved). */
export function selectAudience(profiles: readonly GuestProfile[], spec: CampaignSpec): AudienceSelection {
  const conditions = campaignConditions(spec);
  const matching = profiles.filter((p) => matchesAll(toMetadata(p), conditions.audience));
  const safe = matching.filter((p) => matchesAll(toMetadata(p), conditions.allergy));
  assertAllergySafe(safe, spec.promotedItems);
  return { audience: safe, excludedForAllergy: matching.filter((p) => !safe.includes(p)) };
}
