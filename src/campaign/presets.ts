import { type CampaignSpec, type CampaignSpecInput, CampaignSpecSchema } from "./spec.js";

// Marketing questions the RAG answers out of the box. Thresholds are explained in memo.txt.
const PRESET_INPUTS: readonly CampaignSpecInput[] = [
  {
    id: "red-meat-fans-steak-night",
    title: "Steak Night for red meat fans",
    question: "Which guests love red meat and should get our Beef Steak night invite?",
    query: "loves beef steak, beef burgers and lamb; hearty red meat dinners",
    promotedItems: ["Beef Steak"],
    audience: { minRedMeatShare: 0.5 },
  },
  {
    id: "seafood-fans-barramundi",
    title: "Barramundi special for seafood fans",
    question: "Which seafood lovers should hear about our Barramundi special?",
    query: "loves seafood: barramundi, fish and chips, grilled prawns",
    promotedItems: ["Barramundi"],
    audience: { minSeafoodShare: 0.5 },
  },
  {
    id: "q1-prawn-salad-launch",
    title: "Q1 Grilled Prawn Salad early access",
    question: "Which seafood fans who dine in Q1 should get early access to the Grilled Prawn Salad?",
    query: "seafood lover who orders grilled prawn salad and barramundi in summer",
    promotedItems: ["Grilled Prawn Salad"],
    audience: { minSeafoodShare: 0.5, visitedQuarter: "Q1" },
  },
  {
    id: "seafood-festival-high-spenders",
    title: "Seafood Festival for high spenders",
    question: "Which guests spending $100+ per visit can we invite to the Seafood Festival?",
    query: "high-spending diner who enjoys premium seafood, barramundi and prawns",
    promotedItems: ["Barramundi", "Grilled Prawn Salad", "Fish & Chips"],
    audience: { minAvgSpendPerVisitUsd: 100 },
  },
  {
    id: "vip-event-hosts-room-package",
    title: "VIP room package for big event hosts",
    question: "Which guests host big events (more than 25 people) and should get the VIP room package?",
    query: "hosts large private events, corporate dinners and celebrations in VIP rooms",
    audience: { minLargestParty: 26 },
  },
  {
    id: "christmas-banquet-event-hosts",
    title: "Christmas steak & barramundi banquet",
    question: "Which big event hosts can we offer the Christmas steak and barramundi banquet?",
    query: "hosts large festive banquets with steak and fish in private VIP rooms",
    promotedItems: ["Beef Steak", "Barramundi"],
    audience: { minLargestParty: 26 },
  },
  {
    id: "happy-hour-regulars",
    title: "Happy hour wine & fries deal",
    question: "Which guests like happy hour and should get the wine and fries deal?",
    query: "often visits during happy hour in the late afternoon for drinks and snacks",
    promotedItems: ["House Wine (glass)", "Fries"],
    audience: { minHappyHourShare: 0.5 },
  },
  {
    id: "budget-small-parties-lunch",
    title: "Budget lunch combo for small parties",
    question: "Which small parties (4 or fewer) spending under $100 a visit should get the lunch combo?",
    query: "small casual party, budget-conscious, burgers and soft drinks",
    promotedItems: ["Chicken Burger", "Soft Drink"],
    audience: { maxLargestParty: 4, maxAvgSpendPerVisitUsd: 100 },
  },
  {
    id: "wine-lovers-steak-pairing",
    title: "Steak & wine pairing dinner",
    question: "Which wine lovers should get the steak and wine pairing dinner?",
    query: "enjoys house wine with steak dinners",
    promotedItems: ["Beef Steak", "House Wine (glass)"],
    audience: { minWinePerGuest: 0.75 },
  },
  {
    id: "vegetarian-risotto-q3",
    title: "Q3 Wild Mushroom Risotto",
    question: "Which guests who enjoy vegetarian dishes should hear about the Q3 Wild Mushroom Risotto?",
    query: "enjoys vegetarian dishes like wild mushroom risotto and salads",
    promotedItems: ["Wild Mushroom Risotto"],
    audience: { minVegetarianShare: 0.25 },
  },
  {
    id: "q2-lamb-shank-red-meat-fans",
    title: "Q2 Lamb Shank Ragout launch",
    question: "Which red meat fans who dine in Q2 should get the Lamb Shank Ragout launch?",
    query: "red meat lover who orders lamb shank ragout and steak in autumn",
    promotedItems: ["Lamb Shank Ragout"],
    audience: { minRedMeatShare: 0.5, visitedQuarter: "Q2" },
  },
  {
    id: "seafood-gala-poultry-event-hosts",
    title: "Seafood Gala for poultry-loving event hosts",
    question: "Can we invite our poultry-loving big event hosts to the Seafood Gala?",
    query: "hosts large events and orders chicken and turkey",
    promotedItems: ["Barramundi", "Grilled Prawn Salad"],
    audience: { minPoultryShare: 0.5, minLargestParty: 26 },
  },
];

export const PRESET_CAMPAIGNS: readonly CampaignSpec[] = PRESET_INPUTS.map((input) => CampaignSpecSchema.parse(input));

export class UnknownCampaignError extends Error {
  override readonly name = "UnknownCampaignError";
}

export function findPreset(id: string): CampaignSpec {
  const preset = PRESET_CAMPAIGNS.find((c) => c.id === id);
  if (!preset) throw new UnknownCampaignError(`No preset campaign "${id}"`);
  return preset;
}
