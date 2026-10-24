import { parse } from "csv-parse/sync";
import { z } from "zod";
import { ALLERGENS, type Allergen, type Quarter, QUARTERS, SERVICE_CHARGE_RATE, findMenuItem } from "./menu.js";

export interface InvoiceLine {
  readonly item: string;
  readonly quantity: number;
}

export interface Invoice {
  readonly id: string;
  readonly date: string;
  readonly time: string;
  readonly quarter: Quarter;
  readonly branch: string;
  readonly diningArea: string;
  readonly isVip: boolean;
  readonly guest: { readonly name: string; readonly email: string; readonly phone: string };
  readonly partySize: number;
  readonly allergies: readonly Allergen[];
  readonly lines: readonly InvoiceLine[];
  readonly subtotalUsd: number;
  readonly serviceChargeUsd: number;
  readonly totalUsd: number;
}

const money = z.coerce.number().nonnegative();

const RowSchema = z.object({
  invoice_id: z.string().regex(/^INV-\d{4}-\d{4}$/),
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM"),
  quarter: z.enum(QUARTERS),
  branch: z.enum(["Branch 1", "Branch 2"]),
  dining_area: z.string().min(1),
  service_style: z.enum(["A la carte", "Fine dining"]),
  guest_name: z.string().min(1),
  guest_email: z.email(),
  guest_phone: z.string().min(1),
  party_size: z.coerce.number().int().positive(),
  allergies: z.string().min(1),
  items: z.string().min(1),
  subtotal_usd: money,
  service_charge_usd: money,
  total_usd: money,
});

type Row = z.infer<typeof RowSchema>;

const toCents = (usd: number) => Math.round(usd * 100);
const formatUsd = (cents: number) => (cents / 100).toFixed(2);

function parseAllergies(raw: string): Allergen[] {
  if (raw.trim() === "none") return [];
  return raw.split(";").map((part) => {
    const allergen = ALLERGENS.find((a) => part.trim().startsWith(a));
    if (!allergen) throw new Error(`unknown allergy "${part.trim()}"`);
    return allergen;
  });
}

function parseLines(raw: string): InvoiceLine[] {
  return raw.split(";").map((part) => {
    const match = /^(.+) x(\d+)$/.exec(part.trim());
    if (!match?.[1] || !match[2]) throw new Error(`cannot read item "${part.trim()}"`);
    return { item: match[1], quantity: Number(match[2]) };
  });
}

/** Returns every consistency problem in one row, so bad data is reported in full. */
function findProblems(row: Row, lines: readonly InvoiceLine[]): string[] {
  const unknown = lines.filter((l) => !findMenuItem(l.item)).map((l) => `unknown menu item "${l.item}"`);
  if (unknown.length > 0) return unknown;

  const outOfSeason = lines.flatMap((l) => {
    const season = findMenuItem(l.item)?.season;
    return season && season !== row.quarter ? [`${l.item} is only served in ${season}`] : [];
  });
  const expectedQuarter = `Q${Math.ceil(Number(row.date.slice(5, 7)) / 3)}`;
  const quarterMismatch = expectedQuarter === row.quarter ? [] : [`quarter ${row.quarter} does not match date ${row.date}`];

  const subtotal = lines.reduce((sum, l) => sum + toCents(findMenuItem(l.item)?.priceUsd ?? 0) * l.quantity, 0);
  const service = Math.round(subtotal * SERVICE_CHARGE_RATE);
  const money = (
    [
      ["subtotal", row.subtotal_usd, subtotal],
      ["service charge", row.service_charge_usd, service],
      ["total", row.total_usd, subtotal + service],
    ] as const
  ).flatMap(([label, actual, expected]) =>
    toCents(actual) === expected ? [] : [`${label} ${formatUsd(toCents(actual))} does not match ${formatUsd(expected)}`],
  );

  return [...outOfSeason, ...quarterMismatch, ...money];
}

function toInvoice(record: unknown): Invoice {
  const row = RowSchema.parse(record);
  const lines = parseLines(row.items);
  const problems = findProblems(row, lines);
  if (problems.length > 0) throw new Error(problems.map((p) => `${row.invoice_id}: ${p}`).join("\n"));

  return {
    id: row.invoice_id,
    date: row.date,
    time: row.time,
    quarter: row.quarter,
    branch: row.branch,
    diningArea: row.dining_area,
    isVip: row.dining_area.startsWith("VIP"),
    guest: { name: row.guest_name, email: row.guest_email.toLowerCase(), phone: row.guest_phone },
    partySize: row.party_size,
    allergies: parseAllergies(row.allergies),
    lines,
    subtotalUsd: row.subtotal_usd,
    serviceChargeUsd: row.service_charge_usd,
    totalUsd: row.total_usd,
  };
}

/** Parses and validates invoices.csv. Throws with every problem found; never skips bad rows. */
export function parseInvoicesCsv(csv: string): Invoice[] {
  const records: unknown[] = parse(csv, { columns: true, skip_empty_lines: true, trim: true });
  const results = records.map((record, index) => {
    try {
      return { ok: true as const, invoice: toInvoice(record) };
    } catch (error) {
      const reason = error instanceof z.ZodError ? z.prettifyError(error) : (error as Error).message;
      return { ok: false as const, reason: `row ${index + 2}: ${reason}` };
    }
  });

  const failures = results.flatMap((r) => (r.ok ? [] : [r.reason]));
  if (failures.length > 0) throw new Error(`Invalid invoice data:\n${failures.join("\n")}`);
  return results.flatMap((r) => (r.ok ? [r.invoice] : []));
}
