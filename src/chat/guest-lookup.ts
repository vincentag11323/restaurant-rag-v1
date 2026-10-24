import type { GuestProfile } from "../domain/guest-profile.js";

// Finds guests named in a chat prompt: full name, or a first/last name only one guest has.
// Ambiguous names are not guessed (better to say nothing than show the wrong person).

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/'s\b/g, "");

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `phrase` appears as whole words (apostrophes count as part of a word, e.g. O'Brien). */
const mentions = (text: string, phrase: string) => new RegExp(`(^|[^a-z'])${escapeRegExp(phrase)}($|[^a-z'])`).test(text);

const nameParts = (p: GuestProfile) => normalise(p.name).split(/\s+/).filter(Boolean);

export function findMentionedGuests(prompt: string, profiles: readonly GuestProfile[]): GuestProfile[] {
  const text = normalise(prompt);
  const partCounts = new Map<string, number>();
  for (const part of profiles.flatMap(nameParts)) partCounts.set(part, (partCounts.get(part) ?? 0) + 1);

  return profiles.filter((p) => {
    if (mentions(text, normalise(p.name))) return true;
    return nameParts(p).some((part) => partCounts.get(part) === 1 && mentions(text, part));
  });
}
