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
      "seafood is under a quarter of their mains",
      "at happy hour on at least half of their visits",
    ]);
  });

  test("asks for help when it recognises nothing", () => {
    expect(interpretPrompt("hello there").intent).toBe("help");
  });
});

describe("interpretPrompt: sorting and how many to show", () => {
  test.each([
    ["top 3 biggest spenders", {}, { metric: "totalSpend", direction: "desc" }, 3],
    ["top 5 spenders per visit", {}, { metric: "avgSpendPerVisit", direction: "desc" }, 5],
    ["bottom 3 by total spend", {}, { metric: "totalSpend", direction: "asc" }, 3],
    ["rank guests by visits from least to most", {}, { metric: "visits", direction: "asc" }, undefined],
    ["show 2 seafood fans who spend the least", { minSeafoodShare: 0.5 }, { metric: "totalSpend", direction: "asc" }, 2],
    ["which 5 guests visited most recently", {}, { metric: "lastVisit", direction: "desc" }, 5],
    ["who orders the most seafood", {}, { metric: "seafoodMains", direction: "desc" }, undefined],
    ["rank red meat fans by party size, biggest first", { minRedMeatShare: 0.5 }, { metric: "largestParty", direction: "desc" }, undefined],
    ["show three happy hour regulars", { minHappyHourShare: 0.5 }, undefined, 3],
  ] as const)("%s", (prompt, audience, sort, limit) => {
    const result = interpretPrompt(prompt);

    expect(result.intent).toBe("list");
    expect(result.audience).toEqual(audience);
    expect(result.sort).toEqual(sort);
    expect(result.limit).toBe(limit);
  });

  test("does not read money or party sizes as 'how many to show'", () => {
    expect(interpretPrompt("who spends more than $500 per visit").limit).toBeUndefined();
    expect(interpretPrompt("show parties of 26 or more").limit).toBeUndefined();
  });

  test("echoes the ordering in plain words", () => {
    expect(interpretPrompt("top 3 biggest spenders").understood).toEqual([
      "sorted by total spend, most first",
      "show only 3",
    ]);
  });

  test("keeps the campaign intent when sorting a campaign audience", () => {
    expect(interpretPrompt("campaign for the top 3 spenders")).toMatchObject({
      intent: "campaign",
      sort: { metric: "totalSpend", direction: "desc" },
      limit: 3,
    });
  });
});
