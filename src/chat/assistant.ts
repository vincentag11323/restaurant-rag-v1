import { selectAudience } from "../campaign/audience.js";
import { type CampaignSpecInput, CampaignSpecSchema } from "../campaign/spec.js";
import type { GuestProfile } from "../domain/guest-profile.js";
import { type Allergen, FOOD_GROUPS, type FoodGroup } from "../domain/menu.js";
import type { CampaignReport, CampaignRunner } from "../rag/campaign-runner.js";
import { type Interpretation, interpretPrompt } from "./interpret.js";
import { type CampaignProposal, planCampaign } from "./planner.js";

export const EXAMPLE_PROMPTS: readonly string[] = [
  "create a marketing campaign for non seafood fans",
  "who is allergic to red meat?",
  "campaign for guests who come just to chill",
  "promo for happy hour red meat fans",
  "who spends more than $500 per visit?",
  "who spent over $500 in total?",
  "campaign for big event hosts",
  "deal for wine lovers in small parties",
];

/** Facts shown next to each guest in the chat, so the marketer sees why they are listed. */
export interface GuestFacts {
  readonly guestId: string;
  readonly visits: number;
  readonly avgSpendPerVisitUsd: number;
  readonly totalSpendUsd: number;
  readonly maxPartySize: number;
  readonly happyHourVisits: number;
  readonly chillVisits: number;
  readonly totalMains: number;
  /** Food groups they ordered, most mains first: on how many visits, and how many mains. */
  readonly foods: readonly { readonly group: FoodGroup; readonly visits: number; readonly mains: number }[];
  readonly allergies: readonly Allergen[];
}

export type AssistantReply =
  | { readonly kind: "help"; readonly examples: readonly string[] }
  | { readonly kind: "list"; readonly interpretation: Interpretation; readonly report: CampaignReport; readonly facts: readonly GuestFacts[] }
  | {
      readonly kind: "campaign";
      readonly interpretation: Interpretation;
      readonly proposal: CampaignProposal | null;
      readonly report: CampaignReport | null;
      readonly facts: readonly GuestFacts[];
    };

export interface Assistant {
  reply(prompt: string): Promise<AssistantReply>;
}

interface AssistantDeps {
  readonly runner: CampaignRunner;
  readonly profiles: readonly GuestProfile[];
}

function toFacts(p: GuestProfile): GuestFacts {
  return {
    guestId: p.guestId,
    visits: p.visits,
    avgSpendPerVisitUsd: p.avgSpendPerVisitUsd,
    totalSpendUsd: p.totalSpendUsd,
    maxPartySize: p.maxPartySize,
    happyHourVisits: p.happyHourVisits,
    chillVisits: p.chillVisits,
    totalMains: p.totalMains,
    foods: FOOD_GROUPS.map((group) => ({ group, visits: p.visitsByGroup[group], mains: p.mainsByGroup[group] }))
      .filter((f) => f.mains > 0)
      .toSorted((a, b) => b.mains - a.mains),
    allergies: p.allergies,
  };
}

export function createAssistant({ runner, profiles }: AssistantDeps): Assistant {
  const facts = (report: CampaignReport | null) =>
    (report?.audience.recipients ?? []).flatMap((r) => {
      const profile = profiles.find((p) => p.guestId === r.guestId);
      return profile ? [toFacts(profile)] : [];
    });

  return {
    async reply(prompt) {
      const interpretation = interpretPrompt(prompt);
      if (interpretation.intent === "help") return { kind: "help", examples: EXAMPLE_PROMPTS };

      const base: CampaignSpecInput = {
        id: `chat-${interpretation.intent}`,
        title: "Guest lookup",
        question: prompt,
        query: prompt,
        audience: interpretation.audience,
        promotedItems: [...interpretation.promotedItems],
      };

      if (interpretation.intent === "list") {
        const report = await runner.run(CampaignSpecSchema.parse(base));
        return { kind: "list", interpretation, report, facts: facts(report) };
      }

      // Plan from who matches the rules; the bundle's allergens are then enforced by retrieval.
      const matches = selectAudience(profiles, CampaignSpecSchema.parse(base)).audience;
      const proposal = planCampaign(matches, interpretation.audience.visitedQuarter);
      if (!proposal) return { kind: "campaign", interpretation, proposal: null, report: null, facts: [] };

      const items = [...new Set([...interpretation.promotedItems, ...proposal.bundle.map((l) => l.item)])];
      const spec = CampaignSpecSchema.parse({
        ...base,
        title: proposal.title,
        query: `${prompt}. ${proposal.title}`,
        promotedItems: items,
        offer: proposal.pitch,
      });
      const report = await runner.run(spec);
      return { kind: "campaign", interpretation, proposal, report, facts: facts(report) };
    },
  };
}
