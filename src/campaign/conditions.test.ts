import { describe, expect, test } from "vitest";
import { allergyConditions, audienceConditions, matchesAll, toChromaWhere } from "./conditions.js";
import { assertAllergySafe } from "./safety.js";

describe("audienceConditions", () => {
  test("translates audience rules into metadata conditions", () => {
    const conditions = audienceConditions({ minRedMeatShare: 0.5, maxAvgSpendPerVisitUsd: 100, visitedQuarter: "Q2" });

    expect(conditions.map(({ field, op, value }) => ({ field, op, value }))).toEqual([
      { field: "redMeatPermille", op: "$gte", value: 500 },
      { field: "avgSpendPerVisitCents", op: "$lt", value: 10000 },
      { field: "visitedQ2", op: "$eq", value: true },
    ]);
  });
});

describe("allergyConditions", () => {
  test("excludes guests allergic to any promoted allergen", () => {
    expect(allergyConditions(["seafood", "red meat"]).map(({ field, op, value }) => ({ field, op, value }))).toEqual([
      { field: "allergySeafood", op: "$eq", value: false },
      { field: "allergyRedMeat", op: "$eq", value: false },
    ]);
  });
});

describe("toMetadata encoding", () => {
  test("stores every number as an integer so Chroma never compares an int against a float", () => {
    const conditions = audienceConditions({ minSeafoodShare: 0.5, minWinePerGuest: 0.75, minAvgSpendPerVisitUsd: 99.5 });

    expect(conditions.every((c) => Number.isInteger(c.value))).toBe(true);
  });
});

describe("toChromaWhere", () => {
  const seafoodSafe = allergyConditions(["seafood"]);
  const fans = audienceConditions({ minSeafoodShare: 0.5 });

  test("returns undefined when there is nothing to filter", () => {
    expect(toChromaWhere([])).toBeUndefined();
  });

  test("returns a single clause unwrapped", () => {
    expect(toChromaWhere(seafoodSafe)).toEqual({ allergySeafood: { $eq: false } });
  });

  test("combines several clauses with $and", () => {
    expect(toChromaWhere([...fans, ...seafoodSafe])).toEqual({
      $and: [{ seafoodPermille: { $gte: 500 } }, { allergySeafood: { $eq: false } }],
    });
  });
});

describe("matchesAll", () => {
  const conditions = [...audienceConditions({ minSeafoodShare: 0.5 }), ...allergyConditions(["seafood"])];

  test("accepts metadata meeting every condition, including exact thresholds", () => {
    expect(matchesAll({ seafoodPermille: 500, allergySeafood: false }, conditions)).toBe(true);
  });

  test("rejects metadata failing any condition", () => {
    expect(matchesAll({ seafoodPermille: 900, allergySeafood: true }, conditions)).toBe(false);
    expect(matchesAll({ seafoodPermille: 490, allergySeafood: false }, conditions)).toBe(false);
  });

  test("rejects metadata missing a filtered field", () => {
    expect(matchesAll({ allergySeafood: false }, conditions)).toBe(false);
  });
});

describe("assertAllergySafe", () => {
  const guest = (guestId: string, allergies: ("seafood" | "red meat")[]) => ({ guestId, allergies });

  test("passes when no recipient is allergic to a promoted dish", () => {
    expect(() => assertAllergySafe([guest("guest-a", ["red meat"])], ["Barramundi"])).not.toThrow();
  });

  test("throws, naming guest ids, when a recipient is allergic to a promoted dish", () => {
    expect(() => assertAllergySafe([guest("guest-a", []), guest("guest-b", ["seafood"])], ["Fish & Chips"])).toThrow(
      /guest-b \(seafood\)/,
    );
  });
});

describe("segment rules added for chat prompts", () => {
  const view = (audience: Parameters<typeof audienceConditions>[0]) =>
    audienceConditions(audience).map(({ field, op, value, role }) => ({ field, op, value, role }));

  test("non-fans, chillers, snackers, total spend, VIP and allergy segments", () => {
    expect(
      view({
        maxSeafoodShare: 0.25,
        minChillShare: 0.5,
        minSnackSpendShare: 0.5,
        minTotalSpendUsd: 500,
        minVipVisits: 1,
        allergicTo: "red meat",
        notAllergicTo: "seafood",
      }),
    ).toEqual([
      { field: "seafoodPermille", op: "$lt", value: 250, role: "preference" },
      { field: "chillPermille", op: "$gte", value: 500, role: "preference" },
      { field: "snackSpendPermille", op: "$gte", value: 500, role: "preference" },
      { field: "totalSpendCents", op: "$gte", value: 50000, role: "gate" },
      { field: "vipVisits", op: "$gte", value: 1, role: "gate" },
      { field: "allergyRedMeat", op: "$eq", value: true, role: "gate" },
      { field: "allergySeafood", op: "$eq", value: false, role: "gate" },
    ]);
  });
});
