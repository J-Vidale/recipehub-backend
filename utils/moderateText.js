import { Filter } from "bad-words";

const filter = new Filter();

// A few extra terms worth catching that the base dictionary misses or is
// inconsistent about, kept short and deliberately conservative - this is
// meant to block slurs and abusive language in a free-text field (like a
// custom recipe category), not to police ordinary word choice.
filter.addWords("retard", "retarded");

export const MAX_CATEGORY_LENGTH = 40;

// Returns null when the text is acceptable, or a user-facing message when
// it should be rejected. Applied to any free-text field a user can submit
// in place of a curated option (currently: a custom recipe category).
export const moderateShortText = (text) => {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.length > MAX_CATEGORY_LENGTH) {
    return `Must be ${MAX_CATEGORY_LENGTH} characters or fewer`;
  }
  if (filter.isProfane(trimmed)) {
    return "That contains language we don't allow. Please choose a different name.";
  }
  return null;
};
