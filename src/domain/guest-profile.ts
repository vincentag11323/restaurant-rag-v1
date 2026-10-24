import { createHash } from "node:crypto";
import type { Invoice } from "./invoice.js";
import { type Allergen, FOOD_GROUPS, type FoodGroup, type Quarter, WINE_ITEM, findMenuItem } from "./menu.js";

export interface GuestProfile {
  /** Stable id derived from the email hash, so the vector store never holds contact details. */
  readonly guestId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly allergies: readonly Allergen[];
  readonly visits: number;
  readonly totalSpendUsd: number;
  readonly avgSpendPerVisitUsd: number;
  readonly avgSpendPerGuestUsd: number;
  readonly maxPartySize: number;
  readonly minPartySize: number;
  readonly vipVisits: number;
  readonly happyHourVisits: number;
  readonly happyHourShare: number;
  /** Share of main courses ordered per food group, 0..1. */
  readonly foodShare: Readonly<Record<FoodGroup, number>>;
  readonly winePerGuest: number;
  readonly quarters: readonly Quarter[];
  readonly branches: readonly string[];
  readonly lastVisit: string;
  readonly favouriteMains: readonly string[];
}

const HAPPY_HOUR_START = "16:00";
const HAPPY_HOUR_END = "18:00";
const FAVOURITE_MAINS_SHOWN = 3;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Happy hour is a visit starting 16:00-17:59, any day. */
export function isHappyHour(time: string): boolean {
  return time >= HAPPY_HOUR_START && time < HAPPY_HOUR_END;
}

function countMains(invoices: readonly Invoice[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of invoices.flatMap((i) => i.lines)) {
    if (findMenuItem(line.item)?.category === "main") counts.set(line.item, (counts.get(line.item) ?? 0) + line.quantity);
  }
  return counts;
}

function foodShares(mainCounts: ReadonlyMap<string, number>): Record<FoodGroup, number> {
  const total = [...mainCounts.values()].reduce((a, b) => a + b, 0);
  const byGroup = (group: FoodGroup) =>
    [...mainCounts].filter(([item]) => findMenuItem(item)?.foodGroup === group).reduce((sum, [, n]) => sum + n, 0);
  return Object.fromEntries(FOOD_GROUPS.map((g) => [g, total ? round(byGroup(g) / total, 3) : 0])) as Record<
    FoodGroup,
    number
  >;
}

function buildProfile(invoices: readonly Invoice[]): GuestProfile {
  const sorted = invoices.toSorted((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const latest = sorted.at(-1);
  if (!latest) throw new Error("cannot build a profile without invoices");

  const guests = sorted.reduce((sum, i) => sum + i.partySize, 0);
  const totalSpend = sorted.reduce((sum, i) => sum + i.totalUsd, 0);
  const wine = sorted.flatMap((i) => i.lines).filter((l) => l.item === WINE_ITEM).reduce((s, l) => s + l.quantity, 0);
  const happyHourVisits = sorted.filter((i) => isHappyHour(i.time)).length;
  const mainCounts = countMains(sorted);

  return {
    guestId: `guest-${createHash("sha256").update(latest.guest.email).digest("hex").slice(0, 10)}`,
    name: latest.guest.name,
    email: latest.guest.email,
    phone: latest.guest.phone,
    allergies: latest.allergies,
    visits: sorted.length,
    totalSpendUsd: round(totalSpend, 2),
    avgSpendPerVisitUsd: round(totalSpend / sorted.length, 2),
    avgSpendPerGuestUsd: round(totalSpend / guests, 2),
    maxPartySize: Math.max(...sorted.map((i) => i.partySize)),
    minPartySize: Math.min(...sorted.map((i) => i.partySize)),
    vipVisits: sorted.filter((i) => i.isVip).length,
    happyHourVisits,
    happyHourShare: round(happyHourVisits / sorted.length, 3),
    foodShare: foodShares(mainCounts),
    winePerGuest: round(wine / guests, 3),
    quarters: [...new Set(sorted.map((i) => i.quarter))].sort(),
    branches: [...new Set(sorted.map((i) => i.branch))].sort(),
    lastVisit: latest.date,
    favouriteMains: [...mainCounts]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, FAVOURITE_MAINS_SHOWN)
      .map(([item, n]) => `${item} x${n}`),
  };
}

/** One profile per guest (keyed by email), sorted by name. */
export function buildGuestProfiles(invoices: readonly Invoice[]): GuestProfile[] {
  return [...Map.groupBy(invoices, (i) => i.guest.email).values()]
    .map(buildProfile)
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * Natural-language profile that gets embedded. Deliberately excludes names, contacts and
 * allergies: allergy words would make allergic guests look *similar* to promos for that food.
 */
export function profileText(p: GuestProfile): string {
  const groups = FOOD_GROUPS.filter((g) => p.foodShare[g] > 0)
    .toSorted((a, b) => p.foodShare[b] - p.foodShare[a])
    .map((g) => `${Math.round(p.foodShare[g] * 100)}% ${g}`);
  const parties =
    p.minPartySize === p.maxPartySize ? `party of ${p.maxPartySize}` : `parties of ${p.minPartySize} to ${p.maxPartySize}`;

  return [
    `Diner with ${p.visits} visit(s) in ${p.quarters.join(", ")}, dining in ${parties}.`,
    p.vipVisits > 0 ? `Booked private VIP rooms ${p.vipVisits} time(s) for events.` : "Dines in the main hall.",
    `Main courses ordered: ${groups.join(", ")}.`,
    `Favourite dishes: ${p.favouriteMains.join(", ")}.`,
    `Average spend $${p.avgSpendPerVisitUsd.toFixed(2)} per visit, $${p.avgSpendPerGuestUsd.toFixed(2)} per guest.`,
    p.winePerGuest >= 0.5 ? "Enjoys house wine with meals." : "Rarely orders wine.",
    p.happyHourShare >= 0.5 ? "Often visits during happy hour (16:00-18:00)." : "Usually visits outside happy hour.",
  ].join(" ");
}
