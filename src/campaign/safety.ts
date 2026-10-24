import { type Allergen, allergensOf } from "../domain/menu.js";

export class AllergySafetyError extends Error {
  override readonly name = "AllergySafetyError";
}

interface Recipient {
  readonly guestId: string;
  readonly allergies: readonly Allergen[];
}

/**
 * Last line of defence before anything is sent: throws (never filters silently) if any
 * recipient is allergic to a promoted dish. Errors carry guest ids only, never contacts.
 */
export function assertAllergySafe(recipients: readonly Recipient[], promotedItems: readonly string[]): void {
  const promoted = allergensOf(promotedItems);
  const conflicts = recipients.flatMap((r) => {
    const hits = r.allergies.filter((a) => promoted.includes(a));
    return hits.length > 0 ? [`${r.guestId} (${hits.join(", ")})`] : [];
  });
  if (conflicts.length > 0) {
    throw new AllergySafetyError(`Refusing to target allergic guests: ${conflicts.join("; ")}`);
  }
}
