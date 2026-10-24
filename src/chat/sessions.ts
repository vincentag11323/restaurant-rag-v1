import type { AssistantReply } from "./assistant.js";

export type ChatMessage =
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "assistant"; readonly reply: AssistantReply }
  | { readonly role: "error"; readonly text: string };

export interface ChatStore {
  history(sessionId: string): readonly ChatMessage[];
  append(sessionId: string, ...messages: readonly ChatMessage[]): void;
  reset(sessionId: string): void;
}

const MAX_SESSIONS = 100;
const MAX_MESSAGES = 40;

/** In-memory chat history per browser session. Local tool: history is lost on restart by design. */
export function createChatStore(): ChatStore {
  const sessions = new Map<string, readonly ChatMessage[]>();

  return {
    history: (id) => sessions.get(id) ?? [],
    append(id, ...messages) {
      const next = [...(sessions.get(id) ?? []), ...messages].slice(-MAX_MESSAGES);
      sessions.delete(id); // re-insert so the most recently used session is newest
      sessions.set(id, next);
      const oldest = sessions.keys().next().value;
      if (sessions.size > MAX_SESSIONS && oldest !== undefined) sessions.delete(oldest);
    },
    reset: (id) => {
      sessions.delete(id);
    },
  };
}
