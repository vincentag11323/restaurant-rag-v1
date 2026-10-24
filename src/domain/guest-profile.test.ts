import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildGuestProfiles, isHappyHour, profileText } from "./guest-profile.js";
import { parseInvoicesCsv } from "./invoice.js";

const profiles = buildGuestProfiles(parseInvoicesCsv(readFileSync("data/mock/invoices.csv", "utf8")));
const byName = (name: string) => {
  const profile = profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`no profile for ${name}`);
  return profile;
};

describe("isHappyHour", () => {
  test.each([
    ["15:59", false],
    ["16:00", true],
    ["17:59", true],
    ["18:00", false],
  ])("%s -> %s", (time, expected) => {
    expect(isHappyHour(time)).toBe(expected);
  });
});

describe("buildGuestProfiles", () => {
  test("builds one profile per guest email with a stable non-PII id", () => {
    expect(profiles).toHaveLength(20);
    expect(new Set(profiles.map((p) => p.guestId)).size).toBe(20);
    expect(profiles.every((p) => /^guest-[0-9a-f]{10}$/.test(p.guestId))).toBe(true);
  });

  test("aggregates spend, party size, happy hour and food preferences for a repeat guest", () => {
    expect(byName("Sarah Tan")).toMatchObject({
      visits: 2,
      totalSpendUsd: 255.75,
      avgSpendPerVisitUsd: 127.88,
      maxPartySize: 4,
      vipVisits: 0,
      happyHourVisits: 1,
      happyHourShare: 0.5,
      foodShare: { seafood: 1, "red meat": 0, poultry: 0, vegetarian: 0 },
      winePerGuest: 0.833,
      quarters: ["Q1"],
      allergies: [],
      favouriteMains: ["Grilled Prawn Salad x3", "Barramundi x2", "Fish & Chips x1"],
      chillVisits: 0,
      chillShare: 0,
      snackSpendShare: 0.277,
    });
  });

  test("spots guests who come just to chill (sides and drinks, no mains)", () => {
    expect(byName("Noah Fischer")).toMatchObject({
      visits: 2,
      chillVisits: 2,
      chillShare: 1,
      snackSpendShare: 1,
      happyHourShare: 1,
      foodShare: { seafood: 0, "red meat": 0, poultry: 0, vegetarian: 0 },
      favouriteMains: [],
    });
    expect(byName("Raj Patel")).toMatchObject({ visits: 2, chillVisits: 1, chillShare: 0.5, allergies: ["red meat"] });
  });

  test("counts food groups as visits and as main courses, for 'X of Y' display", () => {
    expect(byName("Sarah Tan")).toMatchObject({
      totalMains: 6,
      mainsByGroup: { seafood: 6, "red meat": 0, poultry: 0, vegetarian: 0 },
      visitsByGroup: { seafood: 2, "red meat": 0, poultry: 0, vegetarian: 0 },
    });
    // One 26-person event: several groups on the same visit, told apart by mains.
    expect(byName("Carlos Rivera")).toMatchObject({
      visits: 1,
      totalMains: 26,
      mainsByGroup: { "red meat": 14, seafood: 6, poultry: 6, vegetarian: 0 },
      visitsByGroup: { "red meat": 1, seafood: 1, poultry: 1, vegetarian: 0 },
    });
  });

  test("captures VIP event hosts and their allergies", () => {
    expect(byName("Olivia Hart")).toMatchObject({
      visits: 2,
      totalSpendUsd: 3388.55,
      maxPartySize: 50,
      vipVisits: 2,
      foodShare: { poultry: 1, seafood: 0, "red meat": 0, vegetarian: 0 },
      allergies: ["seafood", "red meat"],
    });
  });

  test("keeps exact boundary shares used by campaign thresholds", () => {
    expect(byName("Mei Lin Wong").foodShare["red meat"]).toBe(0.5);
    expect(byName("Aisha Rahman").foodShare.seafood).toBe(0.5);
    expect(byName("Michael Chen").happyHourShare).toBe(1);
  });
});

describe("profileText", () => {
  test("describes dining behaviour without names, contacts or allergy words", () => {
    const daniel = byName("Daniel Wright");

    const text = profileText(daniel);

    expect(text).toContain("Lamb Shank Ragout");
    expect(text).not.toMatch(/Daniel|Wright|@|555|allerg|seafood/i);
  });

  test("describes chill-only guests without an empty main-course sentence", () => {
    const text = profileText(byName("Noah Fischer"));

    expect(text).toContain("Comes just to chill with drinks and sides (2 of 2 visits without a main course).");
    expect(text).not.toMatch(/Main courses ordered: \./);
    expect(text).not.toMatch(/Favourite dishes: \./);
  });
});
