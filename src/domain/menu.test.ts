import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MENU, allergensOf, findMenuItem } from "./menu.js";

describe("MENU", () => {
  test("matches every price, allergen tag and season in data/mock/menu.txt", () => {
    // Arrange: the menu book is the human-checked source; code must agree with it.
    const book = readFileSync("data/mock/menu.txt", "utf8");
    const entries = [...book.matchAll(/^(?:(Q\d) \([^)]*\)\s+)?(.+?) \.+\s+([\d.]+)\s+\[([^\]]+)\]/gm)];

    // Act
    const parsed = entries.map(([, season, name, price, tag]) => ({
      name: name?.trim(),
      priceUsd: Number(price),
      allergen: tag === "SEAFOOD" ? "seafood" : tag === "RED MEAT" ? "red meat" : null,
      season: season ?? null,
    }));

    // Assert
    expect(parsed).toEqual(MENU.map(({ name, priceUsd, allergen, season }) => ({ name, priceUsd, allergen, season })));
  });
});

describe("allergensOf", () => {
  test("returns the distinct allergens of the promoted items", () => {
    expect(allergensOf(["Barramundi", "Fish & Chips", "Beef Burger", "Fries"])).toEqual(["seafood", "red meat"]);
  });

  test("returns nothing for allergen-free items", () => {
    expect(allergensOf(["Roast Turkey Plate", "House Wine (glass)"])).toEqual([]);
  });
});

describe("findMenuItem", () => {
  test("returns undefined for items not on the menu", () => {
    expect(findMenuItem("Pizza")).toBeUndefined();
  });
});
