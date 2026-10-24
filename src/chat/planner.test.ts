import { describe, expect, test } from "vitest";
import { selectAudience } from "../campaign/audience.js";
import { type CampaignSpecInput, CampaignSpecSchema } from "../campaign/spec.js";
import { loadGuestProfiles } from "../domain/load-profiles.js";
import { findMenuItem } from "../domain/menu.js";
import { BUNDLE_DISCOUNT, type CampaignProposal, planCampaign } from "./planner.js";

const profiles = loadGuestProfiles("data/mock/invoices.csv");
const audienceFor = (audience: CampaignSpecInput["audience"]) =>
  selectAudience(profiles, CampaignSpecSchema.parse({ id: "t", title: "test", question: "test?", query: "test", audience })).audience;
const plan = (audience: CampaignSpecInput["audience"]) => {
  const proposal = planCampaign(audienceFor(audience));
  if (!proposal) throw new Error("expected a proposal");
  return proposal;
};
const groupsIn = (p: CampaignProposal) => p.bundle.map((l) => findMenuItem(l.item)?.foodGroup).filter(Boolean);

describe("planCampaign", () => {
  test("non seafood fans get a red meat bundle with no seafood in it", () => {
    const proposal = plan({ maxSeafoodShare: 0.25 });

    expect(proposal.theme).toBe("red meat");
    expect(groupsIn(proposal)).not.toContain("seafood");
    expect(proposal.title).toMatch(/Meat Lovers Bundle for \d/);
  });

  test("guests who come just to chill get drinks and sides, no mains", () => {
    const proposal = plan({ minChillShare: 0.5 });

    expect(proposal.theme).toBe("snacks");
    expect(proposal.bundle.every((l) => findMenuItem(l.item)?.category !== "main")).toBe(true);
  });

  test("happy hour regulars get a happy hour time slot", () => {
    expect(plan({ minHappyHourShare: 0.5 }).timing).toBe("Happy hour (16:00-18:00)");
  });

  test("a red-meat-allergic group is never offered red meat", () => {
    const proposal = plan({ allergicTo: "red meat" });

    expect(groupsIn(proposal)).not.toContain("red meat");
  });

  test("prices every bundle from the menu, minus 30%, rounded to a friendly $5", () => {
    for (const audience of [{ maxSeafoodShare: 0.25 }, { minChillShare: 0.5 }, { minLargestParty: 26 }, { minRedMeatShare: 0.5 }]) {
      const p = plan(audience);
      const menu = p.bundle.reduce((sum, l) => sum + (findMenuItem(l.item)?.priceUsd ?? 0) * l.quantity, 0);

      expect(p.menuPriceUsd).toBe(menu);
      expect(p.priceUsd % 5).toBe(0);
      expect(p.priceUsd).toBe(Math.round((menu * (1 - BUNDLE_DISCOUNT)) / 5) * 5);
      expect(p.savingUsd).toBeCloseTo(menu - p.priceUsd, 2);
      expect(p.priceUsd).toBeLessThan(menu);
    }
  });

  test("sizes the bundle to the audience's typical table and explains every choice", () => {
    const proposal = plan({ minRedMeatShare: 0.5, minHappyHourShare: 0.5 });

    expect(proposal.partySize).toBeGreaterThanOrEqual(2);
    expect(proposal.bundle.find((l) => findMenuItem(l.item)?.category === "main")?.quantity).toBe(proposal.partySize);
    expect(proposal.evidence.join(" ")).toMatch(/typical table/i);
    expect(proposal.evidence.join(" ")).toMatch(/happy hour/i);
  });

  test("returns null when nobody matches", () => {
    expect(planCampaign([])).toBeNull();
  });
});

describe("planCampaign tie-breaking", () => {
  test("breaks a tied vote toward the food group that excludes fewer allergic guests", () => {
    // Event hosts vote 2-2 red meat vs poultry; the two poultry hosts are allergic to red meat.
    const proposal = plan({ minLargestParty: 26 });

    expect(proposal.theme).toBe("poultry");
    expect(proposal.evidence.join(" ")).toMatch(/tie/i);
  });
});
