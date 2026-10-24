import { z } from "zod";
import type { AssistantReply } from "../chat/assistant.js";

/** Longer than the worst-case DeepSeek draft (3 attempts x 20s), so the API can fail soft first. */
const REQUEST_TIMEOUT_MS = 90_000;

const EnvelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown(),
  error: z.string().nullable(),
});

export class RagApiError extends Error {
  override readonly name = "RagApiError";
}

export interface RagApiClient {
  ask(prompt: string): Promise<AssistantReply>;
}

/** Talks to the RAG API's POST /campaigns/ask; every failure becomes a RagApiError with a readable message. */
export function createRagApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch): RagApiClient {
  const endpoint = new URL("/campaigns/ask", baseUrl).toString();

  return {
    async ask(prompt) {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new RagApiError(`The RAG API at ${baseUrl} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`);
        }
        throw new RagApiError(`Can't reach the RAG API at ${baseUrl}. Is \`npm run dev\` running?`);
      }

      const envelope = EnvelopeSchema.safeParse(await response.json().catch(() => null));
      if (!envelope.success) throw new RagApiError(`Unexpected response from the RAG API (HTTP ${response.status}).`);
      if (!envelope.data.success) throw new RagApiError(envelope.data.error ?? `RAG API error (HTTP ${response.status}).`);
      // Same-repo contract: the API returns an AssistantReply built from the same types.
      return envelope.data.data as AssistantReply;
    },
  };
}
