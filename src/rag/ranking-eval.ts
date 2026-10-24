import { PRESET_CAMPAIGNS } from "../campaign/presets.js";
import type { GuestProfile } from "../domain/guest-profile.js";
import { type GuestProfileStore, findRecipients } from "./retrieve.js";

/**
 * Hand-labelled ground truth: for each preset, which guest attribute should put the
 * best-fitting guest first. Deliberately written independently of rerank.ts, so the
 * benchmark cannot simply grade the re-ranker against itself.
 */
export const RANKING_GROUND_TRUTH: Readonly<Record<string, (p: GuestProfile) => number>> = {
  "red-meat-fans-steak-night": (p) => p.foodShare["red meat"],
  "seafood-fans-barramundi": (p) => p.foodShare.seafood,
  "q1-prawn-salad-launch": (p) => p.foodShare.seafood,
  "seafood-festival-high-spenders": (p) => p.foodShare.seafood,
  "vip-event-hosts-room-package": (p) => p.maxPartySize,
  "christmas-banquet-event-hosts": (p) => p.maxPartySize,
  "happy-hour-regulars": (p) => p.happyHourShare,
  "budget-small-parties-lunch": (p) => -p.avgSpendPerVisitUsd,
  "wine-lovers-steak-pairing": (p) => p.winePerGuest,
  "vegetarian-risotto-q3": (p) => p.foodShare.vegetarian,
  "q2-lamb-shank-red-meat-fans": (p) => p.foodShare["red meat"],
};

const MIN_AUDIENCE_FOR_RANK_EVAL = 3;

/** Average ranks (1-based), sharing the mean rank across ties. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).toSorted((a, b) => a.v - b.v);
  const result = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]?.v === order[start]?.v) end += 1;
    for (let k = start; k <= end; k += 1) result[order[k]?.i ?? 0] = (start + end) / 2 + 1;
    start = end + 1;
  }
  return result;
}

/** Spearman rank correlation, -1..1. Returns 0 when either side has no variance. */
export function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const [ma, mb] = [mean(ra), mean(rb)];
  const cov = ra.reduce((s, x, i) => s + (x - ma) * ((rb[i] ?? 0) - mb), 0);
  const va = ra.reduce((s, x) => s + (x - ma) ** 2, 0);
  const vb = rb.reduce((s, x) => s + (x - mb) ** 2, 0);
  return va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb);
}

export interface RankingEvalRow {
  readonly campaignId: string;
  readonly spearman: number;
  readonly top1Hit: boolean;
  readonly order: readonly string[];
}

export interface RankingEvalReport {
  readonly rows: readonly RankingEvalRow[];
  readonly meanSpearman: number;
  readonly top1Hits: number;
}

/** Runs every preset through the real pipeline and scores the order against ground truth. */
export async function evaluateRanking(
  store: GuestProfileStore,
  profiles: readonly GuestProfile[],
): Promise<RankingEvalReport> {
  const byId = new Map(profiles.map((p) => [p.guestId, p]));
  const rows: RankingEvalRow[] = [];

  for (const spec of PRESET_CAMPAIGNS) {
    const truth = RANKING_GROUND_TRUTH[spec.id];
    if (!truth) continue;
    const { recipients } = await findRecipients(store, profiles, spec);
    if (recipients.length < MIN_AUDIENCE_FOR_RANK_EVAL) continue;

    const strength = recipients.map((r) => truth(byId.get(r.guestId) as GuestProfile));
    const position = recipients.map((_, i) => recipients.length - i);
    rows.push({
      campaignId: spec.id,
      spearman: Number(spearman(position, strength).toFixed(2)),
      top1Hit: strength[0] === Math.max(...strength),
      order: recipients.map((r) => r.name),
    });
  }

  const meanSpearman = rows.reduce((s, r) => s + r.spearman, 0) / Math.max(rows.length, 1);
  return { rows, meanSpearman: Number(meanSpearman.toFixed(2)), top1Hits: rows.filter((r) => r.top1Hit).length };
}
