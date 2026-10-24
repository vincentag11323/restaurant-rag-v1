import type { GuestProfile } from "../domain/guest-profile.js";
import { type Allergen, QUARTERS } from "../domain/menu.js";
import type { Audience } from "./spec.js";

// One list of conditions drives BOTH the Chroma `where` filter and the in-code re-check,
// so the vector-store filter and the safety post-check can never drift apart.

export type MetadataValue = string | number | boolean;
export type Metadata = Readonly<Record<string, MetadataValue>>;
export type ChromaWhere = Record<string, unknown>;

export interface Condition {
  readonly field: string;
  readonly op: "$gte" | "$lte" | "$lt" | "$eq";
  readonly value: number | boolean;
  /** Human-readable reason, shown as "why this guest was picked". */
  readonly label: string;
}

// Every number is stored as an INTEGER (shares in per-mille, money in cents). Chroma compares
// an int metadata value against a float filter by truncating the float (0 >= 0.5 -> 0 >= 0),
// and JS sends 0 and 1 as ints, so float shares silently let non-matching guests through.
const permille = (share: number) => Math.round(share * 1000);
const cents = (usd: number) => Math.round(usd * 100);

/** Flat, PII-free metadata stored with each guest vector. */
export function toMetadata(p: GuestProfile): Metadata {
  return {
    guestId: p.guestId,
    visits: p.visits,
    totalSpendCents: cents(p.totalSpendUsd),
    avgSpendPerVisitCents: cents(p.avgSpendPerVisitUsd),
    maxPartySize: p.maxPartySize,
    vipVisits: p.vipVisits,
    happyHourPermille: permille(p.happyHourShare),
    redMeatPermille: permille(p.foodShare["red meat"]),
    seafoodPermille: permille(p.foodShare.seafood),
    poultryPermille: permille(p.foodShare.poultry),
    vegetarianPermille: permille(p.foodShare.vegetarian),
    winePerGuestPermille: permille(p.winePerGuest),
    ...Object.fromEntries(QUARTERS.map((q) => [`visited${q}`, p.quarters.includes(q)])),
    allergySeafood: p.allergies.includes("seafood"),
    allergyRedMeat: p.allergies.includes("red meat"),
  };
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const atLeast = (field: string, value: number, label: string): Condition => ({ field, op: "$gte", value, label });

const RULES: { readonly [K in keyof Audience]-?: (value: NonNullable<Audience[K]>) => Condition } = {
  minRedMeatShare: (v) => atLeast("redMeatPermille", permille(v), `red meat is ${pct(v)}+ of mains`),
  minSeafoodShare: (v) => atLeast("seafoodPermille", permille(v), `seafood is ${pct(v)}+ of mains`),
  minPoultryShare: (v) => atLeast("poultryPermille", permille(v), `poultry is ${pct(v)}+ of mains`),
  minVegetarianShare: (v) => atLeast("vegetarianPermille", permille(v), `vegetarian is ${pct(v)}+ of mains`),
  minLargestParty: (v) => atLeast("maxPartySize", v, `has hosted a party of ${v}+`),
  maxLargestParty: (v) => ({ field: "maxPartySize", op: "$lte", value: v, label: `parties of ${v} or fewer` }),
  minAvgSpendPerVisitUsd: (v) => atLeast("avgSpendPerVisitCents", cents(v), `spends $${v}+ per visit`),
  maxAvgSpendPerVisitUsd: (v) => ({
    field: "avgSpendPerVisitCents",
    op: "$lt",
    value: cents(v),
    label: `spends under $${v} per visit`,
  }),
  minHappyHourShare: (v) => atLeast("happyHourPermille", permille(v), `${pct(v)}+ of visits at happy hour`),
  minWinePerGuest: (v) => atLeast("winePerGuestPermille", permille(v), `${v}+ glasses of wine per guest`),
  minVisits: (v) => ({ field: "visits", op: "$gte", value: v, label: `${v}+ visits` }),
  visitedQuarter: (q) => ({ field: `visited${q}`, op: "$eq", value: true, label: `dined in ${q}` }),
};

export function audienceConditions(audience: Audience): Condition[] {
  return Object.entries(audience).flatMap(([key, value]) =>
    value === undefined ? [] : [RULES[key as keyof Audience](value as never)],
  );
}

const ALLERGY_FIELD: Readonly<Record<Allergen, string>> = { seafood: "allergySeafood", "red meat": "allergyRedMeat" };

export function allergyConditions(allergens: readonly Allergen[]): Condition[] {
  return allergens.map((a) => ({ field: ALLERGY_FIELD[a], op: "$eq", value: false, label: `no ${a} allergy` }));
}

export function toChromaWhere(conditions: readonly Condition[]): ChromaWhere | undefined {
  const clauses = conditions.map((c) => ({ [c.field]: { [c.op]: c.value } }));
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function holds(actual: MetadataValue | undefined, c: Condition): boolean {
  if (actual === undefined) return false;
  if (c.op === "$eq") return actual === c.value;
  if (typeof actual !== "number" || typeof c.value !== "number") return false;
  if (c.op === "$gte") return actual >= c.value;
  if (c.op === "$lte") return actual <= c.value;
  return actual < c.value;
}

export function matchesAll(metadata: Metadata, conditions: readonly Condition[]): boolean {
  return conditions.every((c) => holds(metadata[c.field], c));
}
