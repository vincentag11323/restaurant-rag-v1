import { describe, expect, test, vi } from "vitest";
import { loadInvoicesAndProfiles } from "../domain/load-profiles.js";
import { createAssistant } from "./assistant.js";
import { findMentionedGuests } from "./guest-lookup.js";

const { invoices, profiles } = loadInvoicesAndProfiles("data/mock/invoices.csv");
const names = (prompt: string) => findMentionedGuests(prompt, profiles).map((p) => p.name);

describe("findMentionedGuests", () => {
  test.each([
    ["elaborate priya nair", ["Priya Nair"]],
    ["tell me about PRIYA NAIR", ["Priya Nair"]],
    ["what is Sarah Tan's email?", ["Sarah Tan"]],
    ["show me olivia", ["Olivia Hart"]],
    ["details on O'Brien", ["Grace O'Brien"]],
    ["compare priya nair and raj patel", ["Priya Nair", "Raj Patel"]],
  ])("%s", (prompt, expected) => {
    expect(names(prompt)).toEqual(expected);
  });

  test("ignores prompts that mention no guest", () => {
    expect(names("campaign for seafood fans")).toEqual([]);
    expect(names("campaign for big event hosts")).toEqual([]);
  });

  test("does not guess when a first name is shared by several guests", () => {
    const twins = [...profiles, { ...profiles[0], guestId: "guest-x", name: "Priya Shah", email: "p.shah@example.com" }];

    expect(findMentionedGuests("show me priya", twins as typeof profiles)).toEqual([]);
  });
});

describe("assistant guest lookup", () => {
  test("'elaborate priya nair' returns her profile and every invoice, newest first", async () => {
    const runner = { run: vi.fn() };
    const assistant = createAssistant({ runner, profiles, invoices });

    const reply = await assistant.reply("elaborate priya nair");

    expect(runner.run).not.toHaveBeenCalled();
    expect(reply.kind).toBe("guest");
    if (reply.kind !== "guest") return;
    const [priya] = reply.guests;
    expect(priya).toMatchObject({ name: "Priya Nair", email: "priya.nair@example.com", allergies: ["red meat"] });
    expect(priya?.invoices.map((i) => i.id)).toEqual(["INV-2025-0019", "INV-2025-0003"]);
    expect(priya?.facts).toMatchObject({ visits: 2, happyHourVisits: 0 });
  });
});
