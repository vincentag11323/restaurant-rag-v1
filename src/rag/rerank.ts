import { campaignConditions } from "../campaign/audience.js";
import { FOOD_GROUP_FIELD, toMetadata } from "../campaign/conditions.js";
import type { CampaignSpec } from "../campaign/spec.js";
import type { GuestProfile } from "../domain/guest-profile.js";
import { findMenuItem } from "../domain/menu.js";

/**
 * Weight of semantic similarity in the final score; the rest is campaign intent.
 * Tuned with `npm run eval:ranking`: 1.0 (pure vector) scored 0.64 mean Spearman,
 * 0.5 scored 0.87, 0.3 only 0.89, so 0.5 keeps semantics meaningful (see tuning findings).
 */
export const SEMANTIC_WEIGHT = 0.5;

export interface IntentSignal {
  readonly field: string;
  /** +1: higher value ranks higher; -1: lower value ranks higher. */
  readonly direction: 1 | -1;
  readonly label: string;
}

export interface Candidate {
  readonly profile: GuestProfile;
  readonly distance: number;
}

export interface RankedCandidate extends Candidate {
  /** 0..1 within this pool; 1 = semantically closest to the campaign query. */
  readonly semantic: number;
  /** 0..1 within this pool; 1 = strongest on the campaign's own preference signals. */
  readonly intent: number;
  readonly score: number;
}

/**
 * What the campaign is *about*: preference rules (not eligibility gates) plus the food
 * groups of promoted dishes. Embeddings capture topic but not magnitude ("party of 50"
 * vs "party of 32" embed almost identically), so these numbers restore magnitude.
 */
export function intentSignals(spec: CampaignSpec): IntentSignal[] {
  const fromRules = campaignConditions(spec)
    .audience.filter((c) => c.role === "preference" && typeof c.value === "number")
    .map((c): IntentSignal => ({ field: c.field, direction: c.op === "$gte" ? 1 : -1, label: c.label }));

  const fromDishes = spec.promotedItems.flatMap((item): IntentSignal[] => {
    const group = findMenuItem(item)?.foodGroup;
    return group ? [{ field: FOOD_GROUP_FIELD[group], direction: 1, label: `likes ${group} (${item})` }] : [];
  });

  return [...fromRules, ...fromDishes].filter((s, i, all) => all.findIndex((o) => o.field === s.field) === i);
}

/** Min-max scale to 0..1 within the pool; a flat column scores 0.5 for everyone. */
function minMax(values: readonly number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => (hi === lo ? 0.5 : (v - lo) / (hi - lo)));
}

const round3 = (n: number) => Number(n.toFixed(3));

export function hybridRerank(
  candidates: readonly Candidate[],
  signals: readonly IntentSignal[],
  semanticWeight: number = SEMANTIC_WEIGHT,
): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const semantic = minMax(candidates.map((c) => -c.distance));
  const perSignal = signals.map((s) =>
    minMax(candidates.map((c) => s.direction * Number(toMetadata(c.profile)[s.field] ?? 0))),
  );
  const intent = candidates.map((_, i) =>
    perSignal.length === 0 ? 0.5 : perSignal.reduce((sum, col) => sum + (col[i] ?? 0), 0) / perSignal.length,
  );

  return candidates
    .map((c, i) => {
      const sem = semantic[i] ?? 0.5;
      const int = intent[i] ?? 0.5;
      return { ...c, semantic: round3(sem), intent: round3(int), score: round3(semanticWeight * sem + (1 - semanticWeight) * int) };
    })
    .toSorted((a, b) => b.score - a.score || a.distance - b.distance || a.profile.name.localeCompare(b.profile.name));
}
