import { Hono } from "hono";
import { registerChatRoutes } from "../chat/routes.js";
import { type ChatStore, createChatStore } from "../chat/sessions.js";
import { RagApiError, type RagApiClient } from "./api-client.js";

export interface FrontendDeps {
  readonly client: RagApiClient;
  readonly apiUrl: string;
  readonly chats?: ChatStore;
}

/** Standalone chat frontend: same chat page, but every reply comes from the RAG API over HTTP. */
export function createFrontendApp({ client, apiUrl, chats = createChatStore() }: FrontendDeps): Hono {
  const app = new Hono();

  registerChatRoutes(app, {
    reply: (prompt) => client.ask(prompt),
    chats,
    banner: `Talking to the RAG API at ${apiUrl}`,
    describeError: (error) => {
      if (error instanceof RagApiError) return error.message;
      process.stderr.write(`[frontend] unexpected error: ${error instanceof Error ? error.stack : String(error)}\n`);
      return "Something went wrong in the frontend. Check its log.";
    },
  });

  app.notFound((c) => c.text("Not found. The chat is at /", 404));
  return app;
}
