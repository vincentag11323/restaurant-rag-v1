import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatDeepSeek } from "@langchain/deepseek";
import type { CampaignSpec } from "../campaign/spec.js";
import type { AppConfig } from "../config.js";
import { findMenuItem } from "../domain/menu.js";

export interface AudienceSummary {
  readonly size: number;
  readonly reasons: readonly string[];
}

export interface DraftResult {
  /** drafted: LLM wrote copy · dry-run: no API key · skipped: nobody to send to */
  readonly status: "drafted" | "dry-run" | "skipped";
  readonly prompt: string;
  readonly copy: string | null;
  readonly note: string | null;
}

const FIRST_NAME_PLACEHOLDER = "{{first_name}}";

// Only aggregate, PII-free campaign facts are sent to the third-party LLM.
const PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    "You are the marketing copywriter for ResortOS, a two-branch restaurant with a main dining hall and private VIP rooms. " +
      "Write one promotional email: a subject line, then a body of at most 120 words. Greet the guest with {placeholder}. " +
      "Only mention the promoted dishes listed, with the exact prices given. Do not invent discounts, dates or dishes.",
  ],
  [
    "human",
    "Campaign: {title}\nGoal: {question}\nPromoted dishes: {dishes}\nAudience: {size} guests matching: {segment}.",
  ],
]);

const describeDishes = (items: readonly string[]) =>
  items.length === 0
    ? "none (promote the experience, not a dish)"
    : items.map((name) => `${name} ($${(findMenuItem(name)?.priceUsd ?? 0).toFixed(2)})`).join(", ");

function promptVariables(spec: CampaignSpec, audience: AudienceSummary) {
  const segment = audience.reasons.filter((r) => !/allerg/i.test(r));
  return {
    placeholder: FIRST_NAME_PLACEHOLDER,
    title: spec.title,
    question: spec.question,
    dishes: describeDishes(spec.promotedItems),
    size: String(audience.size),
    segment: segment.length > 0 ? segment.join("; ") : "all past guests",
  };
}

export async function buildCampaignPrompt(spec: CampaignSpec, audience: AudienceSummary): Promise<string> {
  const messages = await PROMPT.formatMessages(promptVariables(spec, audience));
  return messages.map((m) => `[${m.type}]\n${String(m.content)}`).join("\n\n");
}

export async function draftCampaignCopy(
  spec: CampaignSpec,
  audience: AudienceSummary,
  deepseek: AppConfig["deepseek"],
): Promise<DraftResult> {
  const prompt = await buildCampaignPrompt(spec, audience);
  if (audience.size === 0) {
    return { status: "skipped", prompt, copy: null, note: "No eligible guests, so no copy was drafted." };
  }
  if (!deepseek.apiKey) {
    return { status: "dry-run", prompt, copy: null, note: "Set DEEPSEEK_API_KEY to draft copy with DeepSeek." };
  }

  const model = new ChatDeepSeek({ apiKey: deepseek.apiKey, model: deepseek.model, temperature: 0.7 });
  const copy = await PROMPT.pipe(model).pipe(new StringOutputParser()).invoke(promptVariables(spec, audience));
  return { status: "drafted", prompt, copy, note: null };
}
