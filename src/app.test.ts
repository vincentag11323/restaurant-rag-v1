import { describe, expect, test, vi } from "vitest";
import { createApp } from "./app.js";
import type { CampaignRunner } from "./rag/campaign-runner.js";
import { IndexOutOfDateError } from "./rag/retrieve.js";

const report = { campaign: { id: "x" }, audience: { count: 0, recipients: [] } } as never;
const fakeRunner = (run: CampaignRunner["run"] = vi.fn().mockResolvedValue(report)): CampaignRunner => ({ run });
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("HTTP API", () => {
  test("GET /campaigns lists the 12 preset marketing questions", async () => {
    const res = await createApp(fakeRunner()).request("/campaigns");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(12);
    expect(body.data[0]).toHaveProperty("question");
  });

  test("GET /campaigns/:id runs the preset through the runner", async () => {
    const run = vi.fn().mockResolvedValue(report);

    const res = await createApp(fakeRunner(run)).request("/campaigns/happy-hour-regulars");

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: "happy-hour-regulars" }));
  });

  test("GET /campaigns/:id returns 404 for an unknown campaign", async () => {
    const res = await createApp(fakeRunner()).request("/campaigns/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, data: null, error: 'No preset campaign "nope"' });
  });

  test("POST /campaigns/run rejects dishes that are not on the menu", async () => {
    const res = await createApp(fakeRunner()).request(
      "/campaigns/run",
      json({ id: "x", title: "Pizza night", question: "Who likes pizza?", query: "pizza", promotedItems: ["Pizza"] }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/promotedItems/);
  });

  test("POST /campaigns/run rejects malformed JSON", async () => {
    const res = await createApp(fakeRunner()).request("/campaigns/run", { method: "POST", body: "{not json" });

    expect(res.status).toBe(400);
  });

  test("POST /campaigns/run runs a valid custom campaign", async () => {
    const run = vi.fn().mockResolvedValue(report);
    const spec = { id: "steak-lovers", title: "Steak lovers", question: "Who loves steak?", query: "steak" };

    const res = await createApp(fakeRunner(run)).request("/campaigns/run", json(spec));

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: "steak-lovers", promotedItems: [], limit: 50 }));
  });

  test("reports a stale index as 503 with the fix", async () => {
    const run = vi.fn().mockRejectedValue(new IndexOutOfDateError("Vector index is out of date. Run `npm run ingest`."));

    const res = await createApp(fakeRunner(run)).request("/campaigns/happy-hour-regulars");

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/npm run ingest/);
  });

  test("hides unexpected internal errors from the client", async () => {
    const run = vi.fn().mockRejectedValue(new Error("db password is hunter2"));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const res = await createApp(fakeRunner(run)).request("/campaigns/happy-hour-regulars");

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    stderr.mockRestore();
  });
});
