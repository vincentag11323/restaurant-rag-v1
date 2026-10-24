import { selectAudience } from "../campaign/audience.js";
import { type CampaignSpecInput, CampaignSpecSchema } from "../campaign/spec.js";
import type { GuestProfile } from "../domain/guest-profile.js";
import type { Invoice } from "../domain/invoice.js";
import { type Allergen, FOOD_GROUPS, type FoodGroup } from "../domain/menu.js";
import type { CampaignReport, CampaignRunner } from "../rag/campaign-runner.js";
import { findMentionedGuests } from "./guest-lookup.js";
import { type Interpretation, interpretPrompt } from "./interpret.js";
import { describeSort, dropNonAnswers, sortProfiles } from "./ordering.js";
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
  "tell me about Priya Nair",
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

/** Everything about one named guest: contact, habits and every invoice (newest first). */
export interface GuestDetails {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly allergies: readonly Allergen[];
  readonly facts: GuestFacts;
  readonly lastVisit: string;
  readonly invoices: readonly Invoice[];
}

export type AssistantReply =
  | { readonly kind: "help"; readonly examples: readonly string[] }
  | { readonly kind: "guest"; readonly guests: readonly GuestDetails[] }
  | {
      readonly kind: "list";
      readonly interpretation: Interpretation;
      readonly report: CampaignReport;
      readonly facts: readonly GuestFacts[];
      /** e.g. "Sorted by total spend, most first · showing 3 of 20"; null when no sort/limit was asked. */
      readonly ordering: string | null;
    }
  | {
      readonly kind: "campaign";
      readonly interpretation: Interpretation;
      readonly proposal: CampaignProposal | null;
      readonly report: CampaignReport | null;
      readonly facts: readonly GuestFacts[];
      readonly ordering: string | null;
    };

export interface Assistant {
  reply(prompt: string): Promise<AssistantReply>;
}

interface AssistantDeps {
  readonly runner: CampaignRunner;
  readonly profiles: readonly GuestProfile[];
  readonly invoices: readonly Invoice[];
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

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Narrows/reorders a report: keep only `keep` (if given), sort by the asked measure, cut to `limit`. */
function applyOrdering(
  report: CampaignReport,
  i: Interpretation,
  profiles: readonly GuestProfile[],
  scope?: { readonly keep: ReadonlySet<string>; readonly total: number },
): { report: CampaignReport; ordering: string | null } {
  const inScope = report.audience.recipients.filter((r) => !scope || scope.keep.has(r.guestId));
  const byId = new Map(inScope.map((r) => [r.guestId, r]));
  const sorted = i.sort
    ? sortProfiles(dropNonAnswers(profiles.filter((p) => byId.has(p.guestId)), i.sort), i.sort).flatMap(
        (p) => byId.get(p.guestId) ?? [],
      )
    : inScope;
  const shown = i.limit === undefined ? sorted : sorted.slice(0, i.limit);
  const excluded = report.excludedForAllergy.guests.filter((g) => !scope || scope.keep.has(g.guestId));

  const asked = i.sort !== undefined || i.limit !== undefined;
  const how = i.sort ? describeSort(i.sort) : "best match first";
  return {
    report: {
      ...report,
      audience: { count: shown.length, recipients: shown },
      excludedForAllergy: { count: excluded.length, guests: excluded },
    },
    ordering: asked ? capitalise(`${how} · showing ${shown.length} of ${scope?.total ?? sorted.length}`) : null,
  };
}

export function createAssistant({ runner, profiles, invoices }: AssistantDeps): Assistant {
  const details = (p: GuestProfile): GuestDetails => ({
    name: p.name,
    email: p.email,
    phone: p.phone,
    allergies: p.allergies,
    facts: toFacts(p),
    lastVisit: p.lastVisit,
    invoices: invoices
      .filter((i) => i.guest.email === p.email)
      .toSorted((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)),
  });

  const facts = (report: CampaignReport | null) =>
    (report?.audience.recipients ?? []).flatMap((r) => {
      const profile = profiles.find((p) => p.guestId === r.guestId);
      return profile ? [toFacts(profile)] : [];
    });

  return {
    async reply(prompt) {
      // A named guest ("elaborate priya nair") is a lookup, not a segment question.
      const named = findMentionedGuests(prompt, profiles);
      if (named.length > 0) return { kind: "guest", guests: named.map(details) };

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
        const ordered = applyOrdering(await runner.run(CampaignSpecSchema.parse(base)), interpretation, profiles);
        return { kind: "list", interpretation, report: ordered.report, facts: facts(ordered.report), ordering: ordered.ordering };
      }

      // Plan from who matches the rules; "top N by X" narrows that group BEFORE planning,
      // so the offer is designed for exactly those guests. Allergens are enforced by retrieval.
      const matches = selectAudience(profiles, CampaignSpecSchema.parse(base)).audience;
      const { sort, limit } = interpretation;
      const scoped = sort ? sortProfiles(dropNonAnswers(matches, sort), sort).slice(0, limit ?? matches.length) : matches;
      const scope = sort ? { keep: new Set(scoped.map((p) => p.guestId)), total: matches.length } : undefined;
      const proposal = planCampaign(scoped, interpretation.audience.visitedQuarter);
      if (!proposal) {
        return { kind: "campaign", interpretation, proposal: null, report: null, facts: [], ordering: null };
      }

      const items = [...new Set([...interpretation.promotedItems, ...proposal.bundle.map((l) => l.item)])];
      const spec = CampaignSpecSchema.parse({
        ...base,
        title: proposal.title,
        query: `${prompt}. ${proposal.title}`,
        promotedItems: items,
        offer: proposal.pitch,
      });
      const ordered = applyOrdering(await runner.run(spec), interpretation, profiles, scope);
      return { kind: "campaign", interpretation, proposal, report: ordered.report, facts: facts(ordered.report), ordering: ordered.ordering };
    },
  };
}
