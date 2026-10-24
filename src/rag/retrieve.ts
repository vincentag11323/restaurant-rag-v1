import type { VectorStore } from "@langchain/core/vectorstores";
import { campaignConditions, selectAudience } from "../campaign/audience.js";
import { type Condition, matchesAll, toChromaWhere, toMetadata } from "../campaign/conditions.js";
import { assertAllergySafe } from "../campaign/safety.js";
import type { CampaignSpec } from "../campaign/spec.js";
import type { GuestProfile } from "../domain/guest-profile.js";
import type { Allergen } from "../domain/menu.js";
import { type Candidate, type IntentSignal, SEMANTIC_WEIGHT, hybridRerank, intentSignals } from "./rerank.js";

export type GuestProfileStore = Pick<VectorStore, "similaritySearchWithScore">;

export interface Recipient {
  readonly guestId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  /** Cosine distance between the campaign query and the guest profile (lower = closer). */
  readonly distance: number;
  /** Final rank score = SEMANTIC_WEIGHT * semantic + (1 - SEMANTIC_WEIGHT) * intent. */
  readonly score: number;
  readonly semantic: number;
  readonly intent: number;
  readonly reasons: readonly string[];
}

export interface ExcludedGuest {
  readonly guestId: string;
  readonly name: string;
  readonly allergies: readonly Allergen[];
}

export interface TraceStep {
  readonly step: "plan" | "search" | "verify" | "rerank" | "draft";
  readonly detail: string;
  readonly ms: number;
}

export interface RetrievalResult {
  readonly recipients: readonly Recipient[];
  readonly excludedForAllergy: readonly ExcludedGuest[];
  readonly rules: readonly string[];
  readonly ranking: { readonly semanticWeight: number; readonly intentSignals: readonly string[] };
  readonly trace: readonly TraceStep[];
}

export class IndexOutOfDateError extends Error {
  override readonly name = "IndexOutOfDateError";
}

const staleIndex = (detail: string) =>
  new IndexOutOfDateError(`Vector index is out of date (${detail}). Run \`npm run ingest\` to rebuild it.`);

/** Runs one pipeline stage and records what it did and how long it took. */
async function timed<T>(
  trace: TraceStep[],
  step: TraceStep["step"],
  run: () => Promise<T> | T,
  describe: (result: T) => string,
): Promise<T> {
  const started = performance.now();
  const result = await run();
  trace.push({ step, detail: describe(result), ms: Math.round(performance.now() - started) });
  return result;
}

interface Plan {
  readonly rules: readonly Condition[];
  readonly signals: readonly IntentSignal[];
  readonly eligible: readonly GuestProfile[];
  readonly excluded: readonly GuestProfile[];
}

/** 1. PLAN: turn the campaign into hard rules + ranking signals; know the expected audience up front. */
function plan(profiles: readonly GuestProfile[], spec: CampaignSpec): Plan {
  const conditions = campaignConditions(spec);
  const selection = selectAudience(profiles, spec);
  return {
    rules: [...conditions.audience, ...conditions.allergy],
    signals: intentSignals(spec),
    eligible: selection.audience,
    excluded: selection.excludedForAllergy,
  };
}

/** 2. SEARCH: Chroma filters by the rules and returns the WHOLE eligible pool, so rerank sees everyone. */
async function search(store: GuestProfileStore, spec: CampaignSpec, p: Plan) {
  if (p.eligible.length === 0) return [];
  return store.similaritySearchWithScore(spec.query, p.eligible.length, toChromaWhere(p.rules));
}

/** 3. VERIFY: re-check every hit against source data (not the index); refuse partial or unsafe results. */
function verify(
  hits: Awaited<ReturnType<typeof search>>,
  profiles: readonly GuestProfile[],
  spec: CampaignSpec,
  p: Plan,
): Candidate[] {
  const byId = new Map(profiles.map((g) => [g.guestId, g]));
  const candidates = hits.map(([doc, distance]) => {
    const profile = byId.get(String(doc.metadata.guestId));
    if (!profile) throw staleIndex(`unknown guest ${String(doc.metadata.guestId)}`);
    return { profile, distance };
  });

  const failing = candidates.filter((c) => !matchesAll(toMetadata(c.profile), p.rules));
  if (failing.length > 0) throw staleIndex(`${failing.length} hit(s) no longer match the campaign rules`);
  assertAllergySafe(
    candidates.map((c) => c.profile),
    spec.promotedItems,
  );
  if (candidates.length !== p.eligible.length) {
    throw staleIndex(`expected ${p.eligible.length} eligible guests, Chroma returned ${candidates.length}`);
  }
  return candidates;
}

/**
 * Campaign retrieval pipeline: PLAN -> SEARCH (Chroma filter + semantic) -> VERIFY (3 safety
 * layers) -> RERANK (semantic + campaign intent) -> top `limit`. Every stage is traced.
 */
export async function findRecipients(
  store: GuestProfileStore,
  profiles: readonly GuestProfile[],
  spec: CampaignSpec,
): Promise<RetrievalResult> {
  const trace: TraceStep[] = [];

  const p = await timed(trace, "plan", () => plan(profiles, spec), (r) =>
    `${r.rules.length} rules; ${r.eligible.length} eligible, ${r.excluded.length} excluded for allergy; ` +
    `rank by ${r.signals.map((s) => s.field).join(", ") || "semantics only"}`,
  );
  const hits = await timed(trace, "search", () => search(store, spec, p), (r) =>
    p.eligible.length === 0 ? "skipped: nobody eligible" : `Chroma returned ${r.length} filtered hit(s)`,
  );
  const candidates = await timed(trace, "verify", () => verify(hits, profiles, spec, p), (r) =>
    `${r.length} hit(s) re-checked against CSV; no allergy conflicts; index complete`,
  );
  const ranked = await timed(trace, "rerank", () => hybridRerank(candidates, p.signals).slice(0, spec.limit), (r) =>
    `top ${r.length} of ${candidates.length}${r[0] ? `; #1 ${r[0].profile.name} (score ${r[0].score})` : ""}`,
  );

  const reasons = p.rules.map((c) => c.label);
  return {
    recipients: ranked.map(({ profile: g, distance, semantic, intent, score }) => ({
      guestId: g.guestId,
      name: g.name,
      email: g.email,
      phone: g.phone,
      distance: Number(distance.toFixed(4)),
      score,
      semantic,
      intent,
      reasons,
    })),
    excludedForAllergy: p.excluded.map((g) => ({ guestId: g.guestId, name: g.name, allergies: g.allergies })),
    rules: reasons,
    ranking: { semanticWeight: SEMANTIC_WEIGHT, intentSignals: p.signals.map((s) => s.label) },
    trace,
  };
}
