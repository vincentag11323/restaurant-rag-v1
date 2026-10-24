import { audienceConditions } from "../campaign/conditions.js";
import { type Audience, AudienceSchema } from "../campaign/spec.js";
import { type Allergen, type FoodGroup, MENU, type Quarter } from "../domain/menu.js";

// Turns a marketer's plain-English prompt into typed audience rules WITHOUT an LLM:
// a small, closed vocabulary that is deterministic, testable and free. Each extractor
// consumes the words it matched so later extractors cannot misread them (e.g. "red meat"
// inside "allergic to red meat" is never also read as "red meat fans").

export interface Interpretation {
  readonly intent: "campaign" | "list" | "help";
  readonly audience: Audience;
  readonly promotedItems: readonly string[];
  /** Plain-words echo of every rule recognised, shown back to the user. */
  readonly understood: readonly string[];
}

const FAN_SHARE = 0.5;
const NON_FAN_SHARE = 0.25;
const SEGMENT_SHARE = 0.5;
const WINE_LOVER_GLASSES = 0.75;
const BIG_PARTY = 26;
const SMALL_PARTY = 4;
const BIG_SPENDER_USD = 100;

const GROUP = "seafood|fish|red[- ]meat|meat|steak|beef|lamb|poultry|chicken|turkey|vegetarian|veggie";
const ALLERGEN_WORDS = "seafood|fish|shellfish|red[- ]meat|meat|beef|lamb";

function toGroup(word: string): FoodGroup {
  if (/seafood|fish/.test(word)) return "seafood";
  if (/poultry|chicken|turkey/.test(word)) return "poultry";
  if (/vegetarian|veggie/.test(word)) return "vegetarian";
  return "red meat";
}
const toAllergen = (word: string): Allergen => (/seafood|fish/.test(word) ? "seafood" : "red meat");

const MIN_SHARE_KEY = { "red meat": "minRedMeatShare", seafood: "minSeafoodShare", poultry: "minPoultryShare", vegetarian: "minVegetarianShare" } as const;
const MAX_SHARE_KEY = { "red meat": "maxRedMeatShare", seafood: "maxSeafoodShare", poultry: "maxPoultryShare", vegetarian: "maxVegetarianShare" } as const;

const toNumber = (raw: string) => Number(raw.replace(/,/g, ""));

type Extractor = readonly [RegExp, (match: RegExpExecArray, text: string) => Audience];

/** Order matters: specific phrases (allergies, negations) run before general ones. */
const EXTRACTORS: readonly Extractor[] = [
  [new RegExp(`\\b(?:not|non|isn'?t|aren'?t)[- ]allergic to (${ALLERGEN_WORDS})\\b`), (m) => ({ notAllergicTo: toAllergen(m[1] ?? "") })],
  [new RegExp(`\\bno (${ALLERGEN_WORDS}) allerg(?:y|ies)\\b`), (m) => ({ notAllergicTo: toAllergen(m[1] ?? "") })],
  [new RegExp(`\\ballergic to (${ALLERGEN_WORDS})\\b`), (m) => ({ allergicTo: toAllergen(m[1] ?? "") })],
  [
    new RegExp(`\\b(?:non|not|no|don'?t like|doesn'?t like|dislikes?|hates?|avoids?)[- ]+(?:the )?(${GROUP})\\b(?: (?:fans?|lovers?|eaters?|people))?`),
    (m) => ({ [MAX_SHARE_KEY[toGroup(m[1] ?? "")]]: NON_FAN_SHARE }),
  ],
  [new RegExp(`\\b(?:loves?|likes?|enjoys?) (${GROUP})\\b`), (m) => ({ [MIN_SHARE_KEY[toGroup(m[1] ?? "")]]: FAN_SHARE })],
  [new RegExp(`\\b(${GROUP}) (?:fans?|lovers?|eaters?)\\b`), (m) => ({ [MIN_SHARE_KEY[toGroup(m[1] ?? "")]]: FAN_SHARE })],
  [/\bhappy[- ]?hours?(?: (?:regulars|fans|lovers|crowd|people|guests|goers))?/, () => ({ minHappyHourShare: SEGMENT_SHARE })],
  [
    /\b(?:just|only) (?:to|for) (?:chill|drinks|hang(?: ?out)?)\b|\bchill(?:ers|ing)?\b|\bonly sides\b|\bsides only\b|\bno mains?\b|\b(?:drinks only|only drinks)\b/,
    () => ({ minChillShare: SEGMENT_SHARE }),
  ],
  [/\bsnack(?:s|ers|ing)?\b/, () => ({ minSnackSpendShare: SEGMENT_SHARE })],
  [/\bwine(?: (?:lovers?|drinkers?|fans?))?\b/, () => ({ minWinePerGuest: WINE_LOVER_GLASSES })],
  [/\b(?:under|less than|below|at most)\s*\$?\s*(\d[\d,]*)/, (m) => ({ maxAvgSpendPerVisitUsd: toNumber(m[1] ?? "0") })],
  [
    /\b(?:more than|over|above|at least)\s*\$?\s*(\d[\d,]*)|\$\s*(\d[\d,]*)\s*\+|\b(\d[\d,]*)\s*\+/,
    (m, text) => {
      const usd = toNumber(m[1] ?? m[2] ?? m[3] ?? "0");
      return /\b(?:in total|total|overall|lifetime|all[- ]time)\b/.test(text)
        ? { minTotalSpendUsd: usd }
        : { minAvgSpendPerVisitUsd: usd };
    },
  ],
  [/\b(?:big|high) spenders?\b|\bhigh rollers?\b/, () => ({ minAvgSpendPerVisitUsd: BIG_SPENDER_USD })],
  [/\bbudget\b/, () => ({ maxAvgSpendPerVisitUsd: BIG_SPENDER_USD })],
  [/\b(?:parties|groups|party|tables?) of (\d+)\s*(?:\+|or more)/, (m) => ({ minLargestParty: toNumber(m[1] ?? "0") })],
  [/\b(?:big|large) (?:parties|groups|tables|events?)\b|\bevent hosts?\b|\bevents?\b/, () => ({ minLargestParty: BIG_PARTY })],
  [/\bsmall (?:parties|groups|tables|party)\b|\bcouples?\b/, () => ({ maxLargestParty: SMALL_PARTY })],
  [/\bvip\b/, () => ({ minVipVisits: 1 })],
  [/\bq([1-4])\b/, (m) => ({ visitedQuarter: `Q${m[1]}` as Quarter })],
  [/\b(?:regulars|loyal|repeat|returning)\b/, () => ({ minVisits: 2 })],
];

const LIST_CUE = /^\s*(?:who|which|whom|list|show|find|how many|give me)\b/;
const CAMPAIGN_CUE = /\b(?:campaign|promo(?:tion)?|offer|deal|marketing|invite|invitation|bundle|plan|promote|special)\b/;

function findDishes(text: string): string[] {
  const normalised = text.replace(/\band\b/g, "&");
  return MENU.filter((item) => {
    const name = item.name.toLowerCase();
    return normalised.includes(name) || text.includes(name.replace("&", "and"));
  }).map((item) => item.name);
}

export function interpretPrompt(prompt: string): Interpretation {
  const original = prompt.toLowerCase().replace(/[?!.]/g, " ");
  let remaining = original;
  let audience: Audience = {};

  for (const [pattern, toRules] of EXTRACTORS) {
    const match = pattern.exec(remaining);
    if (!match) continue;
    const rules = toRules(match, original);
    const alreadySet = Object.keys(rules).some((key) => key in audience);
    if (!alreadySet) audience = { ...audience, ...rules };
    remaining = remaining.replace(match[0], " ");
  }

  const validated = AudienceSchema.parse(audience);
  const promotedItems = findDishes(original);
  // Echo rules in the order the user wrote them (zod re-orders keys to schema order).
  const understood = [
    ...audienceConditions(audience).map((c) => c.label),
    ...(promotedItems.length > 0 ? [`promote ${promotedItems.join(", ")}`] : []),
  ];

  const recognisedNothing = understood.length === 0;
  const intent = recognisedNothing ? "help" : LIST_CUE.test(original) ? "list" : CAMPAIGN_CUE.test(original) ? "campaign" : "list";
  return { intent, audience: validated, promotedItems, understood };
}
