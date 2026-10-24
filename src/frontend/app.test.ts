import { describe, expect, test, vi } from "vitest";
import { RagApiError, type RagApiClient } from "./api-client.js";
import { createFrontendApp } from "./app.js";

const API = "http://localhost:3000";
const form = (prompt: string) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost" },
  body: new URLSearchParams({ prompt }).toString(),
});
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

async function chat(client: RagApiClient, prompt: string): Promise<string> {
  const app = createFrontendApp({ client, apiUrl: API });
  const posted = await app.request("/chat", form(prompt));
  expect(posted.status).toBe(303);
  return (await app.request("/", { headers: { cookie: cookieFrom(posted) } })).text();
}

describe("frontend", () => {
  test("serves the chat page and says which API it talks to", async () => {
    const client: RagApiClient = { ask: vi.fn() };

    const body = await (await createFrontendApp({ client, apiUrl: API }).request("/")).text();

    expect(body).toContain("Campaign RAG chat");
    expect(body).toContain("Talking to the RAG API at http://localhost:3000");
  });

  test("forwards the prompt to the API and shows the reply", async () => {
    const ask = vi.fn().mockResolvedValue({ kind: "help", examples: ["campaign for wine lovers"] });

    const body = await chat({ ask }, "hello");

    expect(ask).toHaveBeenCalledWith("hello");
    expect(body).toContain("campaign for wine lovers");
  });

  test("shows a readable message when the API is down", async () => {
    const ask = vi.fn().mockRejectedValue(new RagApiError("Can't reach the RAG API at http://localhost:3000."));

    expect(await chat({ ask }, "hello")).toContain("Can&#39;t reach the RAG API at http://localhost:3000.");
  });

  test("hides unexpected internal errors", async () => {
    const ask = vi.fn().mockRejectedValue(new Error("secret stack detail"));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const body = await chat({ ask }, "hello");

    expect(body).not.toContain("secret stack detail");
    expect(body).toContain("Something went wrong in the frontend");
    stderr.mockRestore();
  });
});
