import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildGuestProfiles } from "../domain/guest-profile.js";
import { parseInvoicesCsv } from "../domain/invoice.js";
import { selectAudience } from "./audience.js";
import { PRESET_CAMPAIGNS, findPreset } from "./presets.js";

// Marketing questions answered against the 25 mock invoices. Expected audiences were derived
// by hand from data/mock/invoices.csv; see memo.txt for the thresholds behind each segment.
const profiles = buildGuestProfiles(parseInvoicesCsv(readFileSync("data/mock/invoices.csv", "utf8")));
const names = (list: readonly { name: string }[]) => list.map((p) => p.name).sort();

const EXPECTED: Record<string, { audience: string[]; excludedForAllergy: string[] }> = {
  "red-meat-fans-steak-night": {
    audience: ["Carlos Rivera", "Daniel Wright", "Emma Schultz", "James Okafor", "Mei Lin Wong", "Tom Becker"],
    excludedForAllergy: [],
  },
  "seafood-fans-barramundi": {
    audience: ["Aisha Rahman", "Lucas Martin", "Raj Patel", "Sarah Tan"],
    excludedForAllergy: [],
  },
  "q1-prawn-salad-launch": {
    audience: ["Aisha Rahman", "Lucas Martin", "Sarah Tan"],
    excludedForAllergy: [],
  },
  "seafood-festival-high-spenders": {
    audience: [
      "Aisha Rahman", "Carlos Rivera", "Grace O'Brien", "Lucas Martin",
      "Michael Chen", "Priya Nair", "Sarah Tan", "Tom Becker",
    ],
    excludedForAllergy: ["Daniel Wright", "Emma Schultz", "Hannah Kim", "Mei Lin Wong", "Olivia Hart"],
  },
  "vip-event-hosts-room-package": {
    audience: ["Carlos Rivera", "Grace O'Brien", "Hannah Kim", "Lucas Martin", "Olivia Hart"],
    excludedForAllergy: [],
  },
  "christmas-banquet-event-hosts": {
    audience: ["Carlos Rivera", "Grace O'Brien", "Lucas Martin"],
    excludedForAllergy: ["Hannah Kim", "Olivia Hart"],
  },
  "happy-hour-regulars": {
    audience: ["Emma Schultz", "James Okafor", "Lucas Martin", "Michael Chen", "Raj Patel", "Sarah Tan", "Tom Becker"],
    excludedForAllergy: [],
  },
  "budget-small-parties-lunch": {
    audience: ["James Okafor", "Raj Patel"],
    excludedForAllergy: [],
  },
  "wine-lovers-steak-pairing": {
    audience: ["Carlos Rivera", "Grace O'Brien", "James Okafor", "Sarah Tan", "Tom Becker"],
    excludedForAllergy: ["Hannah Kim", "Olivia Hart"],
  },
  "vegetarian-risotto-q3": {
    audience: ["Grace O'Brien", "Priya Nair", "Raj Patel"],
    excludedForAllergy: [],
  },
  "q2-lamb-shank-red-meat-fans": {
    audience: ["Carlos Rivera", "Daniel Wright", "Emma Schultz", "Tom Becker"],
    excludedForAllergy: [],
  },
  "seafood-gala-poultry-event-hosts": {
    audience: [],
    excludedForAllergy: ["Hannah Kim", "Olivia Hart"],
  },
};

describe("preset marketing campaigns", () => {
  test("every preset has an expected audience and vice versa", () => {
    expect(PRESET_CAMPAIGNS.map((c) => c.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test.each(Object.entries(EXPECTED))("%s selects the expected guests", (id, expected) => {
    const result = selectAudience(profiles, findPreset(id));

    expect(names(result.audience)).toEqual(expected.audience);
    expect(names(result.excludedForAllergy)).toEqual(expected.excludedForAllergy);
  });

  test("no preset ever targets a guest allergic to a promoted dish", () => {
    for (const campaign of PRESET_CAMPAIGNS) {
      const { audience } = selectAudience(profiles, campaign);
      const promoted = campaign.promotedItems.join(" ").toLowerCase();
      const unsafe = audience.filter((p) =>
        p.allergies.some((a) =>
          a === "seafood" ? /fish|barramundi|prawn/.test(promoted) : /beef|lamb/.test(promoted),
        ),
      );
      expect(unsafe, campaign.id).toEqual([]);
    }
  });
});
