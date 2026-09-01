import { Filter } from "bad-words";

const filter = new Filter();

// The base dictionary is tuned for chat moderation, not cooking, and it
// rejects a long list of genuine dish names: "Spotted Dick", "Bloody
// Mary", "Cock-a-Leekie", "Boston Butt", "Matzo Balls", "Hell's Kitchen
// Wings", "a knob of butter". Those are the exact "rarer cases of meal we
// miss" this field exists to allow, so the mild terms behind them are
// removed. What stays blocked is the part that matters here: slurs and
// hateful language.
const ALLOWED_IN_FOOD = [
  "butt", // Boston butt, pork butt
  "balls", // matzo balls, rum balls, shrimp balls
  "bloody", // Bloody Mary, bloody Caesar
  "dick", // spotted dick
  "cock", // cock-a-leekie, cock au vin
  "knob", // a knob of butter
  "nob",
  "screw", // screwdriver
  "hell", // Hell's Kitchen
  "damn",
  "crap",
  "bum",
  "arse",
  "bugger",
  "willy",
  "god", // "God-damned" and friends are blasphemy filtering, not hate speech
  "God",
  "god-dam",
  "god-damned",
  "God-damned",
  "goddamn",
  "goddamned",
];
filter.removeWords(...ALLOWED_IN_FOOD);

// A few extra terms worth catching that the base dictionary misses or is
// inconsistent about, kept short and deliberately conservative - this is
// meant to block slurs and abusive language in a free-text field (like a
// custom recipe category), not to police ordinary word choice.
filter.addWords("retard", "retarded");

export const MAX_CATEGORY_LENGTH = 40;

// True when the text carries language we won't publish. Separated from
// moderateShortText so stored values can be re-checked on the way out
// (suggestion lists) without also re-applying the length rule, which only
// governs what may be submitted.
export const containsBlockedLanguage = (text) =>
  typeof text === "string" && text.trim() !== "" && filter.isProfane(text.trim());

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
  if (containsBlockedLanguage(trimmed)) {
    return "That contains language we don't allow. Please choose a different name.";
  }
  return null;
};
