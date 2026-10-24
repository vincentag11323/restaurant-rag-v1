import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { findPreset } from "../campaign/presets.js";
import { buildGuestProfiles } from "../domain/guest-profile.js";
import { parseInvoicesCsv } from "../domain/invoice.js";
import { hybridRerank, intentSignals } from "./rerank.js";

const profiles = buildGuestProfiles(parseInvoicesCsv(readFileSync("data/mock/invoices.csv", "utf8")));
const guest = (name: string) => {
  const p = profiles.find((g) => g.name === name);
  if (!p) throw new Error(name);
  return p;
};
const fields = (id: string) => intentSignals(findPreset(id)).map((s) => `${s.field}:${s.direction}`);

describe("intentSignals", () => {
  test("uses the food group of promoted dishes", () => {
    expect(fields("seafood-fans-barramundi")).toEqual(["seafoodPermille:1"]);
  });

  test("treats spend and season rules as eligibility gates, not intent", () => {
    expect(fields("seafood-festival-high-spenders")).toEqual(["seafoodPermille:1"]);
    expect(fields("q1-prawn-salad-launch")).toEqual(["seafoodPermille:1"]);
  });

  test("uses preference rules when no dish carries a food group", () => {
    expect(fields("happy-hour-regulars")).toEqual(["happyHourPermille:1"]);
    expect(fields("vip-event-hosts-room-package")).toEqual(["maxPartySize:1"]);
  });

  test("ranks smaller parties higher for an upper-bound rule, without duplicating fields", () => {
    expect(fields("budget-small-parties-lunch")).toEqual(["maxPartySize:-1", "poultryPermille:1"]);
    expect(fields("q2-lamb-shank-red-meat-fans")).toEqual(["redMeatPermille:1"]);
  });
});

describe("hybridRerank", () => {
  test("lets a strong intent signal overcome a slightly worse semantic distance", () => {
    // Lucas is semantically closest, but Hannah hosted 50 people vs his 32.
    const ranked = hybridRerank(
      [
        { profile: guest("Lucas Martin"), distance: 0.40 },
        { profile: guest("Hannah Kim"), distance: 0.45 },
        { profile: guest("Carlos Rivera"), distance: 0.60 },
      ],
      intentSignals(findPreset("vip-event-hosts-room-package")),
    );

    expect(ranked.map((r) => r.profile.name)).toEqual(["Hannah Kim", "Lucas Martin", "Carlos Rivera"]);
    expect(ranked[0]).toMatchObject({ semantic: 0.75, intent: 1, score: 0.875 });
  });

  test("falls back to pure semantic order when there is no intent signal", () => {
    const ranked = hybridRerank(
      [
        { profile: guest("Tom Becker"), distance: 0.9 },
        { profile: guest("Sarah Tan"), distance: 0.2 },
      ],
      [],
    );

    expect(ranked.map((r) => r.profile.name)).toEqual(["Sarah Tan", "Tom Becker"]);
    expect(ranked.every((r) => r.intent === 0.5)).toBe(true);
  });

  test("handles a single candidate and an empty pool", () => {
    expect(hybridRerank([{ profile: guest("Raj Patel"), distance: 0.3 }], [])[0]?.score).toBe(0.5);
    expect(hybridRerank([], [])).toEqual([]);
  });
});

describe("spearman", () => {
  test("is 1 for identical order, -1 for reversed, and averages ties", async () => {
    const { spearman } = await import("./ranking-eval.js");

    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
    expect(spearman([1, 2, 3], [5, 5, 5])).toBe(0);
    expect(spearman([1, 2, 3, 4], [1, 1, 2, 2])).toBeCloseTo(0.894, 3);
  });
});
