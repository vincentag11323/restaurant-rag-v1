import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { PRESET_CAMPAIGNS, UnknownCampaignError, findPreset } from "./campaign/presets.js";
import { AllergySafetyError } from "./campaign/safety.js";
import { CampaignSpecSchema } from "./campaign/spec.js";
import type { Assistant } from "./chat/assistant.js";
import { PromptSchema, registerChatRoutes } from "./chat/routes.js";
import { type ChatStore, createChatStore } from "./chat/sessions.js";
import type { CampaignRunner } from "./rag/campaign-runner.js";
import { IndexOutOfDateError } from "./rag/retrieve.js";

interface ApiResponse<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
}

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data, error: null });
const fail = (error: string): ApiResponse<never> => ({ success: false, data: null, error });

class BadRequestError extends Error {
  override readonly name = "BadRequestError";
}


/** Maps known failures to status codes; unexpected errors are logged server-side and hidden from clients. */
function toErrorResponse(error: unknown): { status: ContentfulStatusCode; message: string } {
  if (error instanceof HTTPException) return { status: error.status, message: error.message || "Request not allowed" };
  if (error instanceof BadRequestError) return { status: 400, message: error.message };
  if (error instanceof UnknownCampaignError) return { status: 404, message: error.message };
  if (error instanceof IndexOutOfDateError) return { status: 503, message: error.message };
  if (error instanceof AllergySafetyError) return { status: 500, message: `Campaign blocked: ${error.message}` };
  process.stderr.write(`[api] unexpected error: ${error instanceof Error ? error.stack : String(error)}\n`);
  return { status: 500, message: "Something went wrong on the server. Check the server log." };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequestError("Request body must be valid JSON");
  }
}

function parsePrompt(input: unknown): string {
  const parsed = PromptSchema.safeParse(input);
  if (!parsed.success) throw new BadRequestError(z.prettifyError(parsed.error));
  return parsed.data.prompt;
}

export interface AppDeps {
  readonly runner: CampaignRunner;
  readonly assistant: Assistant;
  readonly chats?: ChatStore;
}

export function createApp({ runner, assistant, chats = createChatStore() }: AppDeps): Hono {
  const app = new Hono();
  // ---- Chat UI (server-rendered HTML), answered in-process by the assistant ----
  registerChatRoutes(app, {
    reply: (prompt) => assistant.reply(prompt),
    chats,
    describeError: (error) => toErrorResponse(error).message,
  });

  // ---- JSON API ----
  app.get("/api", (c) =>
    c.json(
      ok({
        service: "ResortOS Module 1 - VIP Guest & Seasonal Marketing RAG",
        endpoints: {
          "GET /": "chat page",
          "POST /campaigns/ask": "ask in plain English: {\"prompt\": \"create a campaign for non seafood fans\"}",
          "GET /campaigns": "list preset marketing questions",
          "GET /campaigns/:id": "run a preset campaign (audience + allergy exclusions + draft)",
          "POST /campaigns/run": "run a custom campaign spec (JSON body)",
        },
      }),
    ),
  );

  app.post("/campaigns/ask", async (c) => c.json(ok(await assistant.reply(parsePrompt(await readJson(c.req.raw))))));

  app.get("/campaigns", (c) =>
    c.json(ok(PRESET_CAMPAIGNS.map(({ id, title, question, promotedItems }) => ({ id, title, question, promotedItems })))),
  );

  app.get("/campaigns/:id", async (c) => c.json(ok(await runner.run(findPreset(c.req.param("id"))))));

  app.post("/campaigns/run", async (c) => {
    const parsed = CampaignSpecSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) throw new BadRequestError(z.prettifyError(parsed.error));
    return c.json(ok(await runner.run(parsed.data)));
  });

  app.notFound((c) => c.json(fail(`No route ${c.req.method} ${c.req.path}`), 404));
  app.onError((error, c) => {
    const { status, message } = toErrorResponse(error);
    return c.json(fail(message), status);
  });

  return app;
}
