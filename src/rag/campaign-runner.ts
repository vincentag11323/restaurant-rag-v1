import { campaignConditions } from "../campaign/audience.js";
import type { CampaignSpec } from "../campaign/spec.js";
import type { AppConfig } from "../config.js";
import type { GuestProfile } from "../domain/guest-profile.js";
import { type DraftResult, draftCampaignCopy } from "./draft.js";
import { type ExcludedGuest, type GuestProfileStore, type Recipient, findRecipients } from "./retrieve.js";

export interface CampaignReport {
  readonly campaign: CampaignSpec;
  readonly rules: readonly string[];
  readonly audience: { readonly count: number; readonly recipients: readonly Recipient[] };
  readonly excludedForAllergy: { readonly count: number; readonly guests: readonly ExcludedGuest[] };
  readonly draft: DraftResult;
}

export interface CampaignRunner {
  run(spec: CampaignSpec): Promise<CampaignReport>;
}

interface RunnerDeps {
  readonly store: GuestProfileStore;
  readonly profiles: readonly GuestProfile[];
  readonly deepseek: AppConfig["deepseek"];
}

/** Retrieve (hybrid RAG) -> safety-checked audience -> PII-free prompt -> optional DeepSeek draft. */
export function createCampaignRunner({ store, profiles, deepseek }: RunnerDeps): CampaignRunner {
  return {
    async run(spec) {
      const retrieval = await findRecipients(store, profiles, spec);
      const segment = campaignConditions(spec).audience.map((c) => c.label);
      const draft = await draftCampaignCopy(spec, { size: retrieval.recipients.length, reasons: segment }, deepseek);
      return {
        campaign: spec,
        rules: retrieval.rules,
        audience: { count: retrieval.recipients.length, recipients: retrieval.recipients },
        excludedForAllergy: { count: retrieval.excludedForAllergy.length, guests: retrieval.excludedForAllergy },
        draft,
      };
    },
  };
}
