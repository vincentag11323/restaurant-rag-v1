import { readFileSync } from "node:fs";
import { type GuestProfile, buildGuestProfiles } from "./guest-profile.js";
import { parseInvoicesCsv } from "./invoice.js";

/** Reads and validates the invoice CSV, then aggregates it into guest profiles. */
export function loadGuestProfiles(invoicesCsvPath: string): GuestProfile[] {
  return buildGuestProfiles(parseInvoicesCsv(readFileSync(invoicesCsvPath, "utf8")));
}
