import type { GuestProfile } from "../domain/guest-profile.js";
import { type Allergen, type FoodGroup, QUARTERS } from "../domain/menu.js";
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
  /**
   * preference: describes what the campaign is about, so it also drives ranking.
   * gate: eligibility only (spend, visits, season, allergies); never boosts rank.
   */
  readonly role: "preference" | "gate";
  /** Human-readable reason, shown as "why this guest was picked". */
  readonly label: string;
}

// Every number is stored as an INTEGER (shares in per-mille, money in cents). Chroma compares
// an int metadata value against a float filter by truncating the float (0 >= 0.5 -> 0 >= 0),
// and JS sends 0 and 1 as ints, so float shares silently let non-matching guests through.
const permille = (share: number) => Math.round(share * 1000);
const cents = (usd: number) => Math.round(usd * 100);

/** Metadata field holding each food group's share of mains. */
export const FOOD_GROUP_FIELD: Readonly<Record<FoodGroup, string>> = {
  "red meat": "redMeatPermille",
  seafood: "seafoodPermille",
  poultry: "poultryPermille",
  vegetarian: "vegetarianPermille",
};

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
    ...Object.fromEntries(
      Object.entries(FOOD_GROUP_FIELD).map(([group, field]) => [field, permille(p.foodShare[group as FoodGroup])]),
    ),
    winePerGuestPermille: permille(p.winePerGuest),
    chillPermille: permille(p.chillShare),
    snackSpendPermille: permille(p.snackSpendShare),
    ...Object.fromEntries(QUARTERS.map((q) => [`visited${q}`, p.quarters.includes(q)])),
    allergySeafood: p.allergies.includes("seafood"),
    allergyRedMeat: p.allergies.includes("red meat"),
  };
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const rule = (
  role: Condition["role"],
  field: string,
  op: Condition["op"],
  value: number | boolean,
  label: string,
): Condition => ({ field, op, value, role, label });

const ALLERGY_FIELD: Readonly<Record<Allergen, string>> = { seafood: "allergySeafood", "red meat": "allergyRedMeat" };
const below = (field: string, v: number, group: string) =>
  rule("preference", field, "$lt", permille(v), `${group} is under ${pct(v)} of mains`);

const RULES: { readonly [K in keyof Audience]-?: (value: NonNullable<Audience[K]>) => Condition } = {
  minRedMeatShare: (v) => rule("preference", "redMeatPermille", "$gte", permille(v), `red meat is ${pct(v)}+ of mains`),
  minSeafoodShare: (v) => rule("preference", "seafoodPermille", "$gte", permille(v), `seafood is ${pct(v)}+ of mains`),
  minPoultryShare: (v) => rule("preference", "poultryPermille", "$gte", permille(v), `poultry is ${pct(v)}+ of mains`),
  minVegetarianShare: (v) =>
    rule("preference", "vegetarianPermille", "$gte", permille(v), `vegetarian is ${pct(v)}+ of mains`),
  minLargestParty: (v) => rule("preference", "maxPartySize", "$gte", v, `has hosted a party of ${v}+`),
  maxLargestParty: (v) => rule("preference", "maxPartySize", "$lte", v, `parties of ${v} or fewer`),
  minAvgSpendPerVisitUsd: (v) => rule("gate", "avgSpendPerVisitCents", "$gte", cents(v), `spends $${v}+ per visit`),
  // A spend CEILING describes a price-sensitive audience, which is what a budget offer is about,
  // so it ranks (lower spend first). A spend FLOOR is only an eligibility gate (finding F3).
  maxAvgSpendPerVisitUsd: (v) =>
    rule("preference", "avgSpendPerVisitCents", "$lt", cents(v), `spends under $${v} per visit`),
  minHappyHourShare: (v) =>
    rule("preference", "happyHourPermille", "$gte", permille(v), `${pct(v)}+ of visits at happy hour`),
  minWinePerGuest: (v) =>
    rule("preference", "winePerGuestPermille", "$gte", permille(v), `${v}+ glasses of wine per guest`),
  minVisits: (v) => rule("gate", "visits", "$gte", v, `${v}+ visits`),
  visitedQuarter: (q) => rule("gate", `visited${q}`, "$eq", true, `dined in ${q}`),
  maxRedMeatShare: (v) => below("redMeatPermille", v, "red meat"),
  maxSeafoodShare: (v) => below("seafoodPermille", v, "seafood"),
  maxPoultryShare: (v) => below("poultryPermille", v, "poultry"),
  maxVegetarianShare: (v) => below("vegetarianPermille", v, "vegetarian"),
  minChillShare: (v) =>
    rule("preference", "chillPermille", "$gte", permille(v), `${pct(v)}+ of visits just to chill (no mains)`),
  minSnackSpendShare: (v) =>
    rule("preference", "snackSpendPermille", "$gte", permille(v), `${pct(v)}+ of spend on snacks and drinks`),
  minTotalSpendUsd: (v) => rule("gate", "totalSpendCents", "$gte", cents(v), `spent $${v}+ in total`),
  minVipVisits: (v) => rule("gate", "vipVisits", "$gte", v, `booked VIP rooms ${v}+ time(s)`),
  allergicTo: (a) => rule("gate", ALLERGY_FIELD[a], "$eq", true, `allergic to ${a}`),
  notAllergicTo: (a) => rule("gate", ALLERGY_FIELD[a], "$eq", false, `no ${a} allergy`),
};

export function audienceConditions(audience: Audience): Condition[] {
  return Object.entries(audience).flatMap(([key, value]) =>
    value === undefined ? [] : [RULES[key as keyof Audience](value as never)],
  );
}

export function allergyConditions(allergens: readonly Allergen[]): Condition[] {
  return allergens.map((a) => rule("gate", ALLERGY_FIELD[a], "$eq", false, `no ${a} allergy`));
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
