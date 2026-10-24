import { z } from "zod";
import { ALLERGENS, MENU_ITEM_NAMES, QUARTERS } from "../domain/menu.js";

const share = z.number().min(0).max(1);
const usd = z.number().nonnegative();
const count = z.number().int().positive();

/** Hard audience rules. Every rule is optional; all given rules must hold. */
export const AudienceSchema = z
  .object({
    minRedMeatShare: share,
    minSeafoodShare: share,
    minPoultryShare: share,
    minVegetarianShare: share,
    /** Largest party the guest ever booked is at least this many people. */
    minLargestParty: count,
    /** Largest party the guest ever booked is at most this many people. */
    maxLargestParty: count,
    minAvgSpendPerVisitUsd: usd,
    /** Exclusive upper bound. */
    maxAvgSpendPerVisitUsd: usd,
    minHappyHourShare: share,
    minWinePerGuest: z.number().nonnegative(),
    minVisits: count,
    visitedQuarter: z.enum(QUARTERS),
    /** "Non-fans": share of mains in this group is BELOW the value (exclusive). */
    maxRedMeatShare: share,
    maxSeafoodShare: share,
    maxPoultryShare: share,
    maxVegetarianShare: share,
    /** Share of visits with no main course (came just to chill with sides and drinks). */
    minChillShare: share,
    /** Share of item spend on sides and drinks. */
    minSnackSpendShare: share,
    /** Lifetime spend across all visits. */
    minTotalSpendUsd: usd,
    minVipVisits: count,
    /** Segment OF allergic guests, e.g. "who is allergic to red meat". */
    allergicTo: z.enum(ALLERGENS),
    /** Explicitly exclude guests with this allergy, even if no promoted dish contains it. */
    notAllergicTo: z.enum(ALLERGENS),
  })
  .partial()
  .strict();

export const CampaignSpecSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
    title: z.string().min(3),
    /** The marketer's question this campaign answers. */
    question: z.string().min(3),
    /** Semantic description of the ideal guest, used to rank the audience. */
    query: z.string().min(3),
    promotedItems: z.array(z.enum(MENU_ITEM_NAMES)).default([]),
    audience: AudienceSchema.default({}),
    limit: z.number().int().min(1).max(100).default(50),
    /** The concrete offer (e.g. a priced bundle) the draft should promote. */
    offer: z.string().min(3).max(600).optional(),
  })
  .strict();

export type Audience = z.infer<typeof AudienceSchema>;
export type CampaignSpec = z.infer<typeof CampaignSpecSchema>;
export type CampaignSpecInput = z.input<typeof CampaignSpecSchema>;
