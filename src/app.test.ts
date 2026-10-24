import { describe, expect, test, vi } from "vitest";
import { createApp } from "./app.js";
import type { Assistant } from "./chat/assistant.js";
import type { CampaignRunner } from "./rag/campaign-runner.js";
import { IndexOutOfDateError } from "./rag/retrieve.js";

const report = { campaign: { id: "x" }, audience: { count: 0, recipients: [] } } as never;
const fakeRunner = (run: CampaignRunner["run"] = vi.fn().mockResolvedValue(report)): CampaignRunner => ({ run });
const helpAssistant: Assistant = { reply: vi.fn().mockResolvedValue({ kind: "help", examples: ["try this"] }) };
const appWith = (runner: CampaignRunner = fakeRunner(), assistant: Assistant = helpAssistant) => createApp({ runner, assistant });
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("HTTP API", () => {
  test("GET /campaigns lists the 12 preset marketing questions", async () => {
    const res = await appWith().request("/campaigns");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(12);
    expect(body.data[0]).toHaveProperty("question");
  });

  test("GET /campaigns/:id runs the preset through the runner", async () => {
    const run = vi.fn().mockResolvedValue(report);

    const res = await appWith(fakeRunner(run)).request("/campaigns/happy-hour-regulars");

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: "happy-hour-regulars" }));
  });

  test("GET /campaigns/:id returns 404 for an unknown campaign", async () => {
    const res = await appWith().request("/campaigns/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, data: null, error: 'No preset campaign "nope"' });
  });

  test("POST /campaigns/run rejects dishes that are not on the menu", async () => {
    const res = await appWith().request(
      "/campaigns/run",
      json({ id: "x", title: "Pizza night", question: "Who likes pizza?", query: "pizza", promotedItems: ["Pizza"] }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/promotedItems/);
  });

  test("POST /campaigns/run rejects malformed JSON", async () => {
    const res = await appWith().request("/campaigns/run", { method: "POST", body: "{not json" });

    expect(res.status).toBe(400);
  });

  test("POST /campaigns/run runs a valid custom campaign", async () => {
    const run = vi.fn().mockResolvedValue(report);
    const spec = { id: "steak-lovers", title: "Steak lovers", question: "Who loves steak?", query: "steak" };

    const res = await appWith(fakeRunner(run)).request("/campaigns/run", json(spec));

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: "steak-lovers", promotedItems: [], limit: 50 }));
  });

  test("reports a stale index as 503 with the fix", async () => {
    const run = vi.fn().mockRejectedValue(new IndexOutOfDateError("Vector index is out of date. Run `npm run ingest`."));

    const res = await appWith(fakeRunner(run)).request("/campaigns/happy-hour-regulars");

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/npm run ingest/);
  });

  test("hides unexpected internal errors from the client", async () => {
    const run = vi.fn().mockRejectedValue(new Error("db password is hunter2"));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const res = await appWith(fakeRunner(run)).request("/campaigns/happy-hour-regulars");

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    stderr.mockRestore();
  });
});

describe("chat", () => {
  const form = (prompt: string, origin = "http://localhost") => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams({ prompt }).toString(),
  });
  const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  test("GET / serves the chat page", async () => {
    const res = await appWith().request("/");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Campaign RAG chat");
  });

  test("POST /chat answers and redirects back to the conversation, keeping history per session", async () => {
    const app = appWith();

    const posted = await app.request("/chat", form("who loves <script>alert(1)</script>?"));
    const page = await app.request("/", { headers: { cookie: cookieFrom(posted) } });
    const body = await page.text();

    expect(posted.status).toBe(303);
    expect(posted.headers.get("location")).toBe("/#latest");
    expect(body).toContain("who loves &lt;script&gt;alert(1)&lt;/script&gt;?");
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("try this");
  });

  test("POST /chat rejects cross-site form posts (CSRF)", async () => {
    const res = await appWith().request("/chat", form("hi", "https://evil.example"));

    expect(res.status).toBe(403);
  });

  test("POST /chat shows a friendly error when the RAG fails, without leaking internals", async () => {
    const broken: Assistant = { reply: vi.fn().mockRejectedValue(new IndexOutOfDateError("Run `npm run ingest`.")) };
    const app = appWith(fakeRunner(), broken);

    const posted = await app.request("/chat", form("campaign for wine lovers"));
    const body = await (await app.request("/", { headers: { cookie: cookieFrom(posted) } })).text();

    expect(body).toContain("npm run ingest");
  });

  test("POST /campaigns/ask returns the same answer as JSON", async () => {
    const res = await appWith().request("/campaigns/ask", json({ prompt: "who is allergic to red meat?" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ kind: "help", examples: ["try this"] });
  });

  test("POST /campaigns/ask rejects an empty prompt", async () => {
    const res = await appWith().request("/campaigns/ask", json({ prompt: "  " }));

    expect(res.status).toBe(400);
  });
});
