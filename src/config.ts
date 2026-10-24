import { z } from "zod";

const optionalSecret = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  CHROMA_HOST: z.string().min(1).default("localhost"),
  CHROMA_PORT: z.coerce.number().int().positive().default(8000),
  CHROMA_COLLECTION: z.string().min(3).default("guest_profiles"),
  INVOICES_CSV: z.string().min(1).default("data/mock/invoices.csv"),
  DEEPSEEK_API_KEY: optionalSecret,
  DEEPSEEK_MODEL: z.string().min(1).default("deepseek-chat"),
  /** Retries after the first attempt (LangChain's default is 6, which can hang a chat reply). */
  DEEPSEEK_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /** Per-attempt timeout. Worst case per draft = (1 + retries) x timeout. */
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
});

export interface AppConfig {
  readonly port: number;
  readonly chromaHost: string;
  readonly chromaPort: number;
  readonly chromaCollection: string;
  readonly invoicesCsv: string;
  readonly deepseek: {
    readonly apiKey: string | undefined;
    readonly model: string;
    readonly maxRetries: number;
    readonly timeoutMs: number;
  };
}

/** Validates environment at startup; fails fast with every invalid variable listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  const e = parsed.data;
  return {
    port: e.PORT,
    chromaHost: e.CHROMA_HOST,
    chromaPort: e.CHROMA_PORT,
    chromaCollection: e.CHROMA_COLLECTION,
    invoicesCsv: e.INVOICES_CSV,
    deepseek: {
      apiKey: e.DEEPSEEK_API_KEY,
      model: e.DEEPSEEK_MODEL,
      maxRetries: e.DEEPSEEK_MAX_RETRIES,
      timeoutMs: e.DEEPSEEK_TIMEOUT_MS,
    },
  };
}
