// Single source of truth for prices and allergens. Mirrors data/mock/menu.txt (enforced by menu.test.ts).

export const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
export type Quarter = (typeof QUARTERS)[number];

export const ALLERGENS = ["seafood", "red meat"] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const FOOD_GROUPS = ["red meat", "seafood", "poultry", "vegetarian"] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

export interface MenuItem {
  readonly name: string;
  readonly priceUsd: number;
  readonly category: "main" | "side" | "drink";
  /** Set for mains only; drives food-preference features. */
  readonly foodGroup: FoodGroup | null;
  readonly allergen: Allergen | null;
  /** Seasonal specials are only served in this quarter. */
  readonly season: Quarter | null;
}

const main = (name: string, priceUsd: number, foodGroup: FoodGroup, season: Quarter | null = null): MenuItem => ({
  name,
  priceUsd,
  category: "main",
  foodGroup,
  allergen: foodGroup === "seafood" || foodGroup === "red meat" ? foodGroup : null,
  season,
});

const extra = (name: string, priceUsd: number, category: "side" | "drink"): MenuItem => ({
  name,
  priceUsd,
  category,
  foodGroup: null,
  allergen: null,
  season: null,
});

export const MENU: readonly MenuItem[] = [
  main("Chicken Steak", 24, "poultry"),
  main("Beef Steak", 38, "red meat"),
  main("Chicken Burger", 18, "poultry"),
  main("Beef Burger", 21, "red meat"),
  main("Fish & Chips", 22, "seafood"),
  main("Barramundi", 34, "seafood"),
  main("Grilled Prawn Salad", 26, "seafood", "Q1"),
  main("Lamb Shank Ragout", 36, "red meat", "Q2"),
  main("Wild Mushroom Risotto", 25, "vegetarian", "Q3"),
  main("Roast Turkey Plate", 32, "poultry", "Q4"),
  extra("Fries", 7, "side"),
  extra("Garden Salad", 9, "side"),
  extra("Soft Drink", 4.5, "drink"),
  extra("House Wine (glass)", 12, "drink"),
];

export const MENU_ITEM_NAMES = MENU.map((item) => item.name) as [string, ...string[]];
export const SERVICE_CHARGE_RATE = 0.1;
export const WINE_ITEM = "House Wine (glass)";

export function findMenuItem(name: string): MenuItem | undefined {
  return MENU.find((item) => item.name === name);
}

export function allergensOf(itemNames: readonly string[]): Allergen[] {
  const found = itemNames.flatMap((name) => {
    const allergen = findMenuItem(name)?.allergen;
    return allergen ? [allergen] : [];
  });
  return [...new Set(found)];
}
