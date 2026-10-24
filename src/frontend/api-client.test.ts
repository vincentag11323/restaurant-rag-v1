import { describe, expect, test, vi } from "vitest";
import { RagApiError, createRagApiClient } from "./api-client.js";

const API = "http://localhost:3000";
const reply = { kind: "help", examples: ["try this"] };
const respond = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("createRagApiClient", () => {
  test("posts the prompt to /campaigns/ask and returns the reply", async () => {
    const fetchImpl = respond(200, { success: true, data: reply, error: null });

    const result = await createRagApiClient(API, fetchImpl).ask("who is allergic to red meat?");

    expect(result).toEqual(reply);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:3000/campaigns/ask");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: "who is allergic to red meat?" });
  });

  test("passes the API's own error message through", async () => {
    const fetchImpl = respond(503, { success: false, data: null, error: "Vector index is out of date. Run `npm run ingest`." });

    await expect(createRagApiClient(API, fetchImpl).ask("hi")).rejects.toThrow("Vector index is out of date");
  });

  test("explains what to start when the API is not running", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    const error = await createRagApiClient(API, fetchImpl).ask("hi").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RagApiError);
    expect((error as Error).message).toBe("Can't reach the RAG API at http://localhost:3000. Is `npm run dev` running?");
  });

  test("rejects a response that is not the API envelope", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>nope</html>", { status: 200 }));

    await expect(createRagApiClient(API, fetchImpl).ask("hi")).rejects.toThrow(/unexpected response/i);
  });
});
