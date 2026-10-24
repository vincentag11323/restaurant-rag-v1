import { describe, expect, test } from "vitest";
import { interpretPrompt } from "./interpret.js";

describe("interpretPrompt", () => {
  test.each([
    ["create a marketing campaign for non seafood fans", "campaign", { maxSeafoodShare: 0.25 }],
    ["campaign for red meat lovers", "campaign", { minRedMeatShare: 0.5 }],
    ["who is allergic to red meat?", "list", { allergicTo: "red meat" }],
    ["who is not allergic to red meat", "list", { notAllergicTo: "red meat" }],
    ["show guests who always come just to chill", "list", { minChillShare: 0.5 }],
    ["promo for happy hour regulars who love snacks", "campaign", { minHappyHourShare: 0.5, minSnackSpendShare: 0.5 }],
    ["who spends more than $500 per visit", "list", { minAvgSpendPerVisitUsd: 500 }],
    ["who spent over 500 dollars in total", "list", { minTotalSpendUsd: 500 }],
    ["offer for wine lovers in small parties", "campaign", { minWinePerGuest: 0.75, maxLargestParty: 4 }],
    ["campaign for big event hosts who are not allergic to seafood", "campaign", { minLargestParty: 26, notAllergicTo: "seafood" }],
    ["list VIP guests who dined in Q4", "list", { minVipVisits: 1, visitedQuarter: "Q4" }],
    ["deal for guests who don't like chicken", "campaign", { maxPoultryShare: 0.25 }],
    ["which budget guests spend under $100", "list", { maxAvgSpendPerVisitUsd: 100 }],
  ] as const)("%s", (prompt, intent, audience) => {
    const result = interpretPrompt(prompt);

    expect(result.intent).toBe(intent);
    expect(result.audience).toEqual(audience);
  });

  test("does not read 'red meat' inside an allergy phrase as a fan rule", () => {
    expect(interpretPrompt("who is allergic to red meat").audience).not.toHaveProperty("minRedMeatShare");
  });

  test("picks up dishes named in the prompt as items to promote", () => {
    expect(interpretPrompt("promote barramundi and fries to seafood fans").promotedItems).toEqual(["Barramundi", "Fries"]);
  });

  test("explains what it understood in plain words", () => {
    expect(interpretPrompt("create a campaign for non seafood fans at happy hour").understood).toEqual([
      "seafood is under 25% of mains",
      "50%+ of visits at happy hour",
    ]);
  });

  test("asks for help when it recognises nothing", () => {
    expect(interpretPrompt("hello there").intent).toBe("help");
  });
});
