import { campaignConditions } from "../campaign/audience.js";
import type { CampaignSpec } from "../campaign/spec.js";
import type { AppConfig } from "../config.js";
import type { GuestProfile } from "../domain/guest-profile.js";
import { type DraftResult, draftCampaignCopy } from "./draft.js";
import {
  type ExcludedGuest,
  type GuestProfileStore,
  type Recipient,
  type RetrievalResult,
  type TraceStep,
  findRecipients,
} from "./retrieve.js";

export interface CampaignReport {
  readonly campaign: CampaignSpec;
  readonly rules: readonly string[];
  readonly ranking: RetrievalResult["ranking"];
  readonly audience: { readonly count: number; readonly recipients: readonly Recipient[] };
  readonly excludedForAllergy: { readonly count: number; readonly guests: readonly ExcludedGuest[] };
  readonly draft: DraftResult;
  /** plan -> search -> verify -> rerank -> draft, with what each stage did and how long it took. */
  readonly trace: readonly TraceStep[];
}

export interface CampaignRunner {
  run(spec: CampaignSpec): Promise<CampaignReport>;
}

interface RunnerDeps {
  readonly store: GuestProfileStore;
  readonly profiles: readonly GuestProfile[];
  readonly deepseek: AppConfig["deepseek"];
  /** Receives one summary line per campaign run (ids and counts only, no contact details). */
  readonly log?: (line: string) => void;
}

const summarize = (spec: CampaignSpec, trace: readonly TraceStep[]) =>
  `[campaign ${spec.id}] ${trace.map((t) => `${t.step}(${t.ms}ms): ${t.detail}`).join(" | ")}`;

export function createCampaignRunner({ store, profiles, deepseek, log }: RunnerDeps): CampaignRunner {
  return {
    async run(spec) {
      const retrieval = await findRecipients(store, profiles, spec);

      const started = performance.now();
      const segment = campaignConditions(spec).audience.map((c) => c.label);
      const draft = await draftCampaignCopy(spec, { size: retrieval.recipients.length, reasons: segment }, deepseek);
      const trace = [
        ...retrieval.trace,
        { step: "draft" as const, detail: draft.note ?? "copy drafted by DeepSeek", ms: Math.round(performance.now() - started) },
      ];

      log?.(summarize(spec, trace));
      return {
        campaign: spec,
        rules: retrieval.rules,
        ranking: retrieval.ranking,
        audience: { count: retrieval.recipients.length, recipients: retrieval.recipients },
        excludedForAllergy: { count: retrieval.excludedForAllergy.length, guests: retrieval.excludedForAllergy },
        draft,
        trace,
      };
    },
  };
}
