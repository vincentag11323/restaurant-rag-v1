import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseInvoicesCsv } from "./invoice.js";

const csv = readFileSync("data/mock/invoices.csv", "utf8");
const [header = "", firstRow = ""] = csv.split("\n");

describe("parseInvoicesCsv", () => {
  test("parses all 35 mock invoices into typed records", () => {
    const invoices = parseInvoicesCsv(csv);

    expect(invoices).toHaveLength(35);
    expect(invoices[0]).toMatchObject({
      id: "INV-2025-0001",
      date: "2025-02-14",
      time: "19:30",
      quarter: "Q1",
      branch: "Branch 1",
      isVip: false,
      guest: { name: "Sarah Tan", email: "sarah.tan@example.com" },
      partySize: 2,
      allergies: [],
      lines: [
        { item: "Grilled Prawn Salad", quantity: 1 },
        { item: "Barramundi", quantity: 1 },
        { item: "House Wine (glass)", quantity: 2 },
      ],
      totalUsd: 92.4,
    });
  });

  test("reads multiple allergies", () => {
    const olivia = parseInvoicesCsv(csv).find((i) => i.id === "INV-2025-0005");

    expect(olivia?.allergies).toEqual(["seafood", "red meat"]);
    expect(olivia?.isVip).toBe(true);
  });

  test("rejects an item that is not on the menu", () => {
    const bad = firstRow.replace("Barramundi x1", "Pizza x1");

    expect(() => parseInvoicesCsv(`${header}\n${bad}`)).toThrow(/INV-2025-0001: unknown menu item "Pizza"/);
  });

  test("rejects totals that do not match menu prices", () => {
    const bad = firstRow.replace(",92.40", ",99.99");

    expect(() => parseInvoicesCsv(`${header}\n${bad}`)).toThrow(/INV-2025-0001: total 99.99 does not match 92.40/);
  });

  test("rejects a seasonal dish served outside its quarter", () => {
    const bad = firstRow.replace(",Q1,", ",Q2,").replace("2025-02-14", "2025-05-14");

    expect(() => parseInvoicesCsv(`${header}\n${bad}`)).toThrow(/Grilled Prawn Salad is only served in Q1/);
  });
});
