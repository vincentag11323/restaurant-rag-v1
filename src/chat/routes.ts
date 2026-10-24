import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { z } from "zod";
import { type AssistantReply, EXAMPLE_PROMPTS } from "./assistant.js";
import { renderChatPage } from "./page.js";
import type { ChatStore } from "./sessions.js";

// Chat page routes shared by the RAG API (:3000) and the standalone frontend (:3001),
// so both chats behave identically; only where the reply comes from differs.

export const PromptSchema = z.object({ prompt: z.string().trim().min(1, "Please type a question.").max(500) });
const SESSION_COOKIE = "resortos_chat";

/** Anonymous per-browser chat session (random id, httpOnly cookie). */
function sessionId(c: Context): string {
  const existing = getCookie(c, SESSION_COOKIE);
  if (existing) return existing;
  const id = randomUUID();
  setCookie(c, SESSION_COOKIE, id, { httpOnly: true, sameSite: "Lax", path: "/" });
  return id;
}

export interface ChatRouteDeps {
  readonly reply: (prompt: string) => Promise<AssistantReply>;
  readonly chats: ChatStore;
  /** Turns any failure into a message that is safe to show in the chat. */
  readonly describeError: (error: unknown) => string;
  /** Optional line under the page title, e.g. which API the frontend talks to. */
  readonly banner?: string;
}

export function registerChatRoutes(app: Hono, { reply, chats, describeError, banner }: ChatRouteDeps): void {
  app.use("/chat", csrf());
  app.use("/chat/*", csrf());

  app.get("/", (c) => c.html(renderChatPage(chats.history(sessionId(c)), EXAMPLE_PROMPTS, banner)));

  app.post("/chat", async (c) => {
    const id = sessionId(c);
    const parsed = PromptSchema.safeParse({ prompt: (await c.req.parseBody()).prompt });
    if (!parsed.success) {
      chats.append(id, { role: "error", text: parsed.error.issues[0]?.message ?? "Please type a question." });
      return c.redirect("/#latest", 303);
    }
    chats.append(id, { role: "user", text: parsed.data.prompt });
    try {
      chats.append(id, { role: "assistant", reply: await reply(parsed.data.prompt) });
    } catch (error) {
      chats.append(id, { role: "error", text: describeError(error) });
    }
    return c.redirect("/#latest", 303);
  });

  app.post("/chat/reset", (c) => {
    chats.reset(sessionId(c));
    return c.redirect("/", 303);
  });
}
