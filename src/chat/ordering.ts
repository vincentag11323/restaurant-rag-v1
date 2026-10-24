import type { GuestProfile } from "../domain/guest-profile.js";

// "Rank / sort / top N" for chat questions: one typed vocabulary of measures, so a future
// LLM parser can emit the same SortSpec that the phrase reader emits today.

export const METRICS = [
  "totalSpend",
  "avgSpendPerVisit",
  "visits",
  "largestParty",
  "happyHourVisits",
  "chillVisits",
  "winePerGuest",
  "lastVisit",
  "seafoodMains",
  "redMeatMains",
  "poultryMains",
  "vegetarianMains",
] as const;
export type Metric = (typeof METRICS)[number];

export interface SortSpec {
  readonly metric: Metric;
  /** desc = most / biggest / latest first; asc = least / smallest / oldest first. */
  readonly direction: "asc" | "desc";
}

export const METRIC_LABEL: Readonly<Record<Metric, string>> = {
  totalSpend: "total spend",
  avgSpendPerVisit: "spend per visit",
  visits: "number of visits",
  largestParty: "largest party",
  happyHourVisits: "happy hour visits",
  chillVisits: "drinks-and-sides visits",
  winePerGuest: "wine per guest",
  lastVisit: "last visit",
  seafoodMains: "seafood mains ordered",
  redMeatMains: "red meat mains ordered",
  poultryMains: "chicken mains ordered",
  vegetarianMains: "vegetarian mains ordered",
};

export function metricValue(p: GuestProfile, metric: Metric): number {
  switch (metric) {
    case "totalSpend":
      return p.totalSpendUsd;
    case "avgSpendPerVisit":
      return p.avgSpendPerVisitUsd;
    case "visits":
      return p.visits;
    case "largestParty":
      return p.maxPartySize;
    case "happyHourVisits":
      return p.happyHourVisits;
    case "chillVisits":
      return p.chillVisits;
    case "winePerGuest":
      return p.winePerGuest;
    case "lastVisit":
      return Date.parse(p.lastVisit);
    case "seafoodMains":
      return p.mainsByGroup.seafood;
    case "redMeatMains":
      return p.mainsByGroup["red meat"];
    case "poultryMains":
      return p.mainsByGroup.poultry;
    case "vegetarianMains":
      return p.mainsByGroup.vegetarian;
  }
}

/** Count-like measures where "who has the most" should not list guests with none at all. */
const COUNT_METRICS: ReadonlySet<Metric> = new Set([
  "happyHourVisits", "chillVisits", "winePerGuest", "seafoodMains", "redMeatMains", "poultryMains", "vegetarianMains",
]);

/** For "most X" questions, guests with zero X are not answers; for "least X" they are. */
export function dropNonAnswers(profiles: readonly GuestProfile[], sort: SortSpec): GuestProfile[] {
  if (sort.direction === "asc" || !COUNT_METRICS.has(sort.metric)) return [...profiles];
  return profiles.filter((p) => metricValue(p, sort.metric) > 0);
}

/** Stable sort by the metric; ties are broken by name so results never shuffle between runs. */
export function sortProfiles(profiles: readonly GuestProfile[], sort: SortSpec): GuestProfile[] {
  const sign = sort.direction === "desc" ? -1 : 1;
  return profiles.toSorted(
    (a, b) => sign * (metricValue(a, sort.metric) - metricValue(b, sort.metric)) || a.name.localeCompare(b.name),
  );
}

export function describeSort(sort: SortSpec): string {
  const first =
    sort.metric === "lastVisit"
      ? sort.direction === "desc" ? "most recent first" : "longest ago first"
      : sort.direction === "desc" ? "most first" : "least first";
  return `sorted by ${METRIC_LABEL[sort.metric]}, ${first}`;
}
