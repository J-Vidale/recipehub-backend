import { describe, it, expect } from "vitest";
import {
  moderateShortText,
  containsBlockedLanguage,
  MAX_CATEGORY_LENGTH,
} from "../utils/moderateText.js";

// The custom-category field exists so people can name a dish the curated
// list does not cover. A filter that rejects real food defeats it, and one
// that lets slurs through defeats the point of having a filter. These
// tests pin both ends.
describe("real dish names are allowed through", () => {
  it.each([
    "Spotted Dick",
    "Bloody Mary",
    "Cock-a-Leekie",
    "Coq au Vin",
    "Boston Butt",
    "Pork Butt",
    "Matzo Balls",
    "Rum Balls",
    "Shrimp Balls",
    "Hell's Kitchen Wings",
    "Knob of Butter",
    "Screwdriver",
    "Devils Food Cake",
    "Toad in the Hole",
    "Bangers and Mash",
    "Bubble and Squeak",
    "Nan's Sunday Roast",
  ])("accepts %s", (name) => {
    expect(moderateShortText(name)).toBeNull();
  });
});

describe("abusive language is still rejected", () => {
  // Assembled at runtime so the repository does not carry the words
  // themselves in readable form.
  const slur = () => "n" + "igger";
  const swear = () => "f" + "uck";

  it.each([
    ["a slur", `${slur()} stew`],
    ["a swear", `${swear()} this dish`],
    ["a term added on top of the dictionary", "retard special"],
  ])("rejects %s", (_label, text) => {
    expect(moderateShortText(text)).not.toBeNull();
  });
});

describe("length", () => {
  it("rejects text over the limit with a message naming it", () => {
    const tooLong = "x".repeat(MAX_CATEGORY_LENGTH + 1);
    expect(moderateShortText(tooLong)).toMatch(new RegExp(`${MAX_CATEGORY_LENGTH} characters`));
  });

  it("accepts text exactly at the limit", () => {
    expect(moderateShortText("x".repeat(MAX_CATEGORY_LENGTH))).toBeNull();
  });

  it("measures the trimmed text, not the raw input", () => {
    expect(moderateShortText(`  ${"x".repeat(MAX_CATEGORY_LENGTH)}  `)).toBeNull();
  });
});

describe("empty and non-string input", () => {
  it.each([["", "empty"], ["   ", "whitespace"]])("accepts %o (%s) as nothing to moderate", (text) => {
    expect(moderateShortText(text)).toBeNull();
  });

  it.each([null, undefined, 42, {}])("does not throw on %o", (value) => {
    expect(() => moderateShortText(value)).not.toThrow();
    expect(moderateShortText(value)).toBeNull();
  });
});

describe("containsBlockedLanguage", () => {
  // Split out from moderateShortText so stored values can be re-checked on
  // the way out without re-applying the length rule, which only governs
  // what may be submitted.
  it("ignores length entirely", () => {
    expect(containsBlockedLanguage("x".repeat(500))).toBe(false);
  });

  it("still catches blocked words", () => {
    expect(containsBlockedLanguage("retard food")).toBe(true);
  });

  it("returns false for empty or non-string input", () => {
    expect(containsBlockedLanguage("")).toBe(false);
    expect(containsBlockedLanguage(null)).toBe(false);
    expect(containsBlockedLanguage(7)).toBe(false);
  });
});
