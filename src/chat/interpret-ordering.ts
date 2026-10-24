import type { Metric, SortSpec } from "./ordering.js";

// Reads "rank / sort / top N / bottom N / least to most" from a prompt. Runs before the
// segment extractors and consumes the words it used, so "biggest spenders" is read as a
// sort, not as the "big spenders" filter.

export interface Ordering {
  readonly sort?: SortSpec;
  readonly limit?: number;
  /** The prompt with the sorting words removed, for the segment extractors. */
  readonly remaining: string;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const NUM = `(\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;
const toCount = (raw: string) => NUMBER_WORDS[raw] ?? Number(raw);

const GROUP_METRIC: readonly (readonly [RegExp, Metric])[] = [
  [/seafood|fish/, "seafoodMains"],
  [/chicken|poultry/, "poultryMains"],
  [/vegetarian|veggie/, "vegetarianMains"],
  [/red[- ]meat|meat|steak|beef|lamb/, "redMeatMains"],
];
const GROUP = "seafood|fish|red[- ]meat|meat|steak|beef|lamb|chicken|poultry|vegetarian|veggie";
const groupMetric = (word: string): Metric => GROUP_METRIC.find(([re]) => re.test(word))?.[1] ?? "redMeatMains";

/** Words after "by": "rank by total spend", "sorted by party size". Most specific first. */
const BY_METRIC: readonly (readonly [string, Metric])[] = [
  ["spend per visit|per visit|average spend|avg spend", "avgSpendPerVisit"],
  ["total spend|spending|spend|spent|money|revenue", "totalSpend"],
  ["last visit|recency|most recent", "lastVisit"],
  ["visits|visit count|frequency|times visited", "visits"],
  ["party size|group size|table size|party|parties", "largestParty"],
  ["happy[- ]?hours?", "happyHourVisits"],
  ["drinks and sides|chill", "chillVisits"],
  ["wine", "winePerGuest"],
  [GROUP, "redMeatMains"], // resolved to the right food group below
];

const most = (word: string | undefined): SortSpec["direction"] => (word === "least" || word === "fewest" ? "asc" : "desc");

/** Superlatives that carry both the measure and the direction. Recency before visits. */
const SUPERLATIVES: readonly (readonly [RegExp, (m: RegExpExecArray) => SortSpec])[] = [
  [/\b(?:visited\s+)?(?:the\s+)?most\s+recent(?:ly)?\b|\bnewest\b/, () => ({ metric: "lastVisit", direction: "desc" })],
  [/\bleast\s+recent(?:ly)?\b|\blongest\s+ago\b|\bhaven'?t\s+(?:visited|been|come)\s+in\s+a\s+while\b/, () => ({ metric: "lastVisit", direction: "asc" })],
  [new RegExp(`\\b(?:top|biggest|highest|best)\\s+(?:${NUM}\\s+)?spenders?\\b`), () => ({ metric: "totalSpend", direction: "desc" })],
  [new RegExp(`\\b(?:lowest|smallest)\\s+(?:${NUM}\\s+)?spenders?\\b`), () => ({ metric: "totalSpend", direction: "asc" })],
  [/\bspen(?:d|ds|t|ding)\s+(?:the\s+)?(most|least)\b/, (m) => ({ metric: "totalSpend", direction: most(m[1]) })],
  [/\b(most|fewest|least)\s+visits\b/, (m) => ({ metric: "visits", direction: most(m[1]) })],
  [/\bvisit(?:s|ed)?\s+(?:the\s+)?(most|least)\b/, (m) => ({ metric: "visits", direction: most(m[1]) })],
  [/\b(?:biggest|largest)\s+(?:parties|party|groups?|tables?|events?|hosts?)\b/, () => ({ metric: "largestParty", direction: "desc" })],
  [/\bsmallest\s+(?:parties|party|groups?|tables?)\b/, () => ({ metric: "largestParty", direction: "asc" })],
  [/\b(most|least)\s+(?:often\s+)?(?:at\s+)?happy[- ]?hours?\b/, (m) => ({ metric: "happyHourVisits", direction: most(m[1]) })],
  [/\b(?:drinks?\s+|orders?\s+)?(?:the\s+)?(most|least)\s+wine\b/, (m) => ({ metric: "winePerGuest", direction: most(m[1]) })],
  [
    new RegExp(`\\b(?:eats?\\s+|orders?\\s+|ordered\\s+)?(?:the\\s+)?(most|least)\\s+(${GROUP})\\b`),
    (m) => ({ metric: groupMetric(m[2] ?? ""), direction: most(m[1]) }),
  ],
];

const ASCENDING = /\b(?:least to most|ascending|lowest first|smallest first|fewest first|low to high|oldest first)\b/;
const DESCENDING = /\b(?:most to least|descending|highest first|biggest first|largest first|high to low|newest first|latest first)\b/;

const LIMITS: readonly (readonly [RegExp, "top" | "bottom" | null])[] = [
  [new RegExp(`\\b(?:top|first|best)\\s+${NUM}\\b`), "top"],
  [new RegExp(`\\b(?:bottom|last|worst)\\s+${NUM}\\b`), "bottom"],
  [new RegExp(`\\b(?:show|only|just|list|give\\s+me|get)\\s+(?:me\\s+)?(?:the\\s+)?(?:only\\s+)?${NUM}\\b`), null],
  [new RegExp(`\\b${NUM}\\s+(?:guests?|people|customers?|users?|results?|names?|diners?)\\b`), null],
];

function readSort(text: string): { sort?: SortSpec; remaining: string } {
  for (const [pattern, toSort] of SUPERLATIVES) {
    const match = pattern.exec(text);
    if (match) return { sort: toSort(match), remaining: text.replace(match[0], " ") };
  }
  for (const [words, metric] of BY_METRIC) {
    const match = new RegExp(`\\bby\\s+(${words})\\b`).exec(text);
    if (!match) continue;
    const resolved = metric === "redMeatMains" ? groupMetric(match[1] ?? "") : metric;
    return { sort: { metric: resolved, direction: "desc" }, remaining: text.replace(match[0], " ") };
  }
  return { remaining: text };
}

export function readOrdering(text: string): Ordering {
  const limitMatch = LIMITS.map(([re, end]) => ({ match: re.exec(text), end })).find((l) => l.match);
  const limit = limitMatch?.match?.[1] ? toCount(limitMatch.match[1]) : undefined;

  const { sort: found, remaining } = readSort(text);
  if (!found) return { limit, remaining };

  // "spenders per visit" / "spend per visit" means the per-visit measure.
  const metric = found.metric === "totalSpend" && /\bper visit\b/.test(text) ? "avgSpendPerVisit" : found.metric;
  const explicit = ASCENDING.test(text) ? "asc" : DESCENDING.test(text) ? "desc" : null;
  const fromLimit = limitMatch?.end === "bottom" ? "asc" : limitMatch?.end === "top" ? "desc" : null;
  return { sort: { metric, direction: explicit ?? fromLimit ?? found.direction }, limit, remaining };
}
