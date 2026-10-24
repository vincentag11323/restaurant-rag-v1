import { StringOutputParser } from "@langchain/core/output_parsers";
import type { BaseMessage } from "@langchain/core/messages";
import type { BasePromptValueInterface } from "@langchain/core/prompt_values";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { RunnableLike } from "@langchain/core/runnables";
import { ChatDeepSeek } from "@langchain/deepseek";
import type { CampaignSpec } from "../campaign/spec.js";
import type { AppConfig } from "../config.js";
import { findMenuItem } from "../domain/menu.js";

export interface AudienceSummary {
  readonly size: number;
  readonly reasons: readonly string[];
}

export interface DraftResult {
  /** drafted: LLM wrote copy · dry-run: no API key · skipped: nobody to send to · unavailable: LLM failed */
  readonly status: "drafted" | "dry-run" | "skipped" | "unavailable";
  readonly prompt: string;
  readonly copy: string | null;
  readonly note: string | null;
}

const FIRST_NAME_PLACEHOLDER = "{{first_name}}";
const MAX_REASON_LENGTH = 160;

export interface ChatModelOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
  readonly maxRetries: number;
  readonly timeout: number;
}

/** Builds the chat model; injectable so tests never call the real API. */
export type ChatModelFactory = (options: ChatModelOptions) => RunnableLike<BasePromptValueInterface, BaseMessage | string>;

const deepSeekModel: ChatModelFactory = (options) => new ChatDeepSeek(options);

/** Short, single-line reason safe to show in the chat (no stack traces). */
function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, MAX_REASON_LENGTH);
}

// Only aggregate, PII-free campaign facts are sent to the third-party LLM.
const PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    "You are the marketing copywriter for ResortOS, a two-branch restaurant with a main dining hall and private VIP rooms. " +
      "Write one promotional email: a subject line, then a body of at most 120 words. Greet the guest with {placeholder}. " +
      "Only mention the offer and promoted dishes listed, with the exact prices given. Do not invent discounts, dates or dishes.",
  ],
  [
    "human",
    "Campaign: {title}\nGoal: {question}\nOffer: {offer}\nPromoted dishes: {dishes}\nAudience: {size} guests matching: {segment}.",
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
    offer: spec.offer ?? "none; invite them to visit",
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
  createModel: ChatModelFactory = deepSeekModel,
): Promise<DraftResult> {
  const prompt = await buildCampaignPrompt(spec, audience);
  if (audience.size === 0) {
    return { status: "skipped", prompt, copy: null, note: "No eligible guests, so no copy was drafted." };
  }
  if (!deepseek.apiKey) {
    return { status: "dry-run", prompt, copy: null, note: "Set DEEPSEEK_API_KEY to draft copy with DeepSeek." };
  }

  const model = createModel({
    apiKey: deepseek.apiKey,
    model: deepseek.model,
    temperature: 0.7,
    maxRetries: deepseek.maxRetries,
    timeout: deepseek.timeoutMs,
  });
  try {
    const copy = await PROMPT.pipe(model).pipe(new StringOutputParser()).invoke(promptVariables(spec, audience));
    return { status: "drafted", prompt, copy, note: null };
  } catch (error) {
    // Fail soft: the audience and offer are already computed and still useful without copy.
    const attempts = deepseek.maxRetries + 1;
    const note = `Draft unavailable: DeepSeek failed after up to ${attempts} attempts (${failureReason(error)}).`;
    return { status: "unavailable", prompt, copy: null, note };
  }
}
