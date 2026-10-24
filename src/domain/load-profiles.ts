import { readFileSync } from "node:fs";
import { type GuestProfile, buildGuestProfiles } from "./guest-profile.js";
import { type Invoice, parseInvoicesCsv } from "./invoice.js";

/** Reads and validates the invoice CSV once, returning the invoices and the guest profiles built from them. */
export function loadInvoicesAndProfiles(invoicesCsvPath: string): { invoices: Invoice[]; profiles: GuestProfile[] } {
  const invoices = parseInvoicesCsv(readFileSync(invoicesCsvPath, "utf8"));
  return { invoices, profiles: buildGuestProfiles(invoices) };
}

/** Reads and validates the invoice CSV, then aggregates it into guest profiles. */
export function loadGuestProfiles(invoicesCsvPath: string): GuestProfile[] {
  return loadInvoicesAndProfiles(invoicesCsvPath).profiles;
}
