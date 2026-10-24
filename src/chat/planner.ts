import type { GuestProfile } from "../domain/guest-profile.js";
import { FOOD_GROUPS, type FoodGroup, type Quarter, WINE_ITEM, findMenuItem } from "../domain/menu.js";

// The campaign planner: given the guests a prompt selected, design an offer they will
// actually want. Every decision is derived from their invoices and explained in `evidence`.
// Prices always come from the menu (minus BUNDLE_DISCOUNT), so the offer is never invented.

export const BUNDLE_DISCOUNT = 0.3;
const PRICE_STEP_USD = 5;
const MIN_BUNDLE_SIZE = 2;
const MAX_BUNDLE_SIZE = 8;
const HABIT = 0.5;

export type Theme = FoodGroup | "snacks";

export interface BundleLine {
  readonly item: string;
  readonly quantity: number;
}

export interface CampaignProposal {
  readonly title: string;
  readonly theme: Theme;
  readonly timing: "Happy hour (16:00-18:00)" | "Dinner";
  readonly partySize: number;
  readonly bundle: readonly BundleLine[];
  readonly menuPriceUsd: number;
  readonly priceUsd: number;
  readonly savingUsd: number;
  /** One line a marketer can read out: what, for how many, how much, when. */
  readonly pitch: string;
  readonly evidence: readonly string[];
}

const THEME_LABEL: Readonly<Record<Theme, string>> = {
  "red meat": "Meat Lovers",
  seafood: "Seafood",
  poultry: "Chicken",
  vegetarian: "Veggie",
  snacks: "Chill & Sip",
};
const DEFAULT_DISH: Readonly<Record<FoodGroup, string | null>> = {
  "red meat": "Beef Burger",
  seafood: "Fish & Chips",
  poultry: "Chicken Burger",
  vegetarian: null, // the only vegetarian main is a Q3 seasonal special
};

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

interface Vote {
  readonly theme: FoodGroup | null;
  readonly votes: number;
  readonly diners: number;
  /** Set when a tie was broken in favour of the group that excludes fewer allergic guests. */
  readonly tieNote: string | null;
}

const allergicTo = (audience: readonly GuestProfile[], group: FoodGroup) =>
  audience.filter((p) => p.allergies.some((a) => a === group)).length;

/** Each diner votes once for the food group they order most, so one 50-person table can't outvote everyone. */
function voteTheme(audience: readonly GuestProfile[]): Vote {
  const diners = audience.filter((p) => p.chillShare < 1);
  const ballots = diners.map((p) => FOOD_GROUPS.reduce((best, g) => (p.foodShare[g] > p.foodShare[best] ? g : best)));
  const ranked = FOOD_GROUPS.map((g) => ({ g, votes: ballots.filter((b) => b === g).length, allergic: allergicTo(audience, g) }))
    .filter((t) => t.votes > 0)
    .toSorted((a, b) => b.votes - a.votes || a.allergic - b.allergic);

  const [winner, runnerUp] = ranked;
  if (!winner) return { theme: null, votes: 0, diners: diners.length, tieNote: null };
  const tied = runnerUp && runnerUp.votes === winner.votes && runnerUp.allergic !== winner.allergic;
  const tieNote = tied
    ? `Tie: ${winner.votes} vote(s) each for ${winner.g} and ${runnerUp.g}; chose ${winner.g} because ${runnerUp.g} ` +
      `would exclude ${runnerUp.allergic} allergic guest(s).`
    : null;
  return { theme: winner.g, votes: winner.votes, diners: diners.length, tieNote };
}

/** The dish this audience orders most within the theme, skipping out-of-season specials. */
function pickDish(audience: readonly GuestProfile[], group: FoodGroup, quarter?: Quarter): string | null {
  const counts = new Map<string, number>();
  for (const fav of audience.flatMap((p) => p.favouriteMains)) {
    const match = /^(.+) x(\d+)$/.exec(fav);
    const item = match?.[1] ? findMenuItem(match[1]) : undefined;
    if (!item || item.foodGroup !== group || (item.season && item.season !== quarter)) continue;
    counts.set(item.name, (counts.get(item.name) ?? 0) + Number(match?.[2]));
  }
  const top = [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
  return top ?? DEFAULT_DISH[group];
}

function priceBundle(bundle: readonly BundleLine[]) {
  const menuPriceUsd = bundle.reduce((sum, l) => sum + (findMenuItem(l.item)?.priceUsd ?? 0) * l.quantity, 0);
  const priceUsd = Math.round((menuPriceUsd * (1 - BUNDLE_DISCOUNT)) / PRICE_STEP_USD) * PRICE_STEP_USD;
  return { menuPriceUsd, priceUsd, savingUsd: Number((menuPriceUsd - priceUsd).toFixed(2)) };
}

export function planCampaign(audience: readonly GuestProfile[], quarter?: Quarter): CampaignProposal | null {
  if (audience.length === 0) return null;

  const vote = voteTheme(audience);
  const chillers = audience.filter((p) => p.chillShare >= HABIT).length;
  const dish = vote.theme && chillers <= vote.diners / 2 ? pickDish(audience, vote.theme, quarter) : null;
  const theme: Theme = dish && vote.theme ? vote.theme : "snacks";

  const tableSizes = audience.map((p) => Math.round(p.avgSpendPerVisitUsd / p.avgSpendPerGuestUsd));
  const partySize = Math.min(MAX_BUNDLE_SIZE, Math.max(MIN_BUNDLE_SIZE, Math.round(median(tableSizes))));
  const happyHourFans = audience.filter((p) => p.happyHourShare >= HABIT).length;
  const timing = happyHourFans >= audience.length / 2 ? "Happy hour (16:00-18:00)" : "Dinner";
  const wineLovers = median(audience.map((p) => p.winePerGuest)) >= HABIT;
  const drink = wineLovers ? WINE_ITEM : "Soft Drink";
  const shared = Math.ceil(partySize / 2);

  const bundle: BundleLine[] = dish
    ? [{ item: dish, quantity: partySize }, { item: "Fries", quantity: shared }, { item: drink, quantity: partySize }]
    : [{ item: "Fries", quantity: shared }, { item: "Garden Salad", quantity: shared }, { item: drink, quantity: partySize }];
  const price = priceBundle(bundle);
  const title = `${timing === "Dinner" ? "" : "Happy Hour "}${THEME_LABEL[theme]} Bundle for ${partySize}`;
  const contents = bundle.map((l) => `${l.quantity}x ${l.item}`).join(" + ");

  return {
    title,
    theme,
    timing,
    partySize,
    bundle,
    ...price,
    pitch:
      `${title}: ${contents} for ${usd(price.priceUsd)} (menu ${usd(price.menuPriceUsd)}, save ${usd(price.savingUsd)}). ` +
      `${timing}, dine-in.`,
    evidence: [
      `${audience.length} guest(s) match your request.`,
      theme === "snacks"
        ? `${chillers} of ${audience.length} come just to chill with drinks and sides, so the offer skips mains.`
        : `${vote.votes} of ${vote.diners} diners order mostly ${theme}; their most-ordered ${theme} dish is ${dish}.`,
      ...(theme !== "snacks" && vote.tieNote ? [vote.tieNote] : []),
      `Typical table: ${partySize} people (median), so the bundle feeds ${partySize}.`,
      `${happyHourFans} of ${audience.length} usually come at happy hour, so the slot is: ${timing}.`,
      `Drinks: ${wineLovers ? "they drink wine with meals" : "most don't drink much wine"}, so ${drink}.`,
      `They usually spend ${usd(median(audience.map((p) => p.avgSpendPerGuestUsd)))} per guest; ` +
        `the bundle is ${usd(Number((price.priceUsd / partySize).toFixed(2)))} per guest (menu price minus ${BUNDLE_DISCOUNT * 100}%).`,
    ],
  };
}
