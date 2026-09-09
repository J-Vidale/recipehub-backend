import { describe, it, expect } from "vitest";
import {
  validateUsername,
  validateEmail,
  validatePassword,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
} from "../utils/credentials.js";

describe("validateUsername", () => {
  it.each(["marta", "marta_cooks", "joe.cooks-99", "A1b"])("accepts %s", (name) => {
    expect(validateUsername(name)).toBeNull();
  });

  it("requires something", () => {
    for (const value of [undefined, null, "", "   ", 42, {}]) {
      expect(validateUsername(value)).toMatch(/required/);
    }
  });

  it("has a floor and a ceiling", () => {
    expect(validateUsername("ab")).toMatch(/at least 3/);
    expect(validateUsername("a".repeat(MAX_USERNAME_LENGTH))).toBeNull();
    expect(validateUsername("a".repeat(MAX_USERNAME_LENGTH + 1))).toMatch(/30 characters or fewer/);
  });

  // The whole point of the shape rule: characters that render as nothing,
  // or exactly like other characters, are how one account comes to look
  // like another on a site where people follow each other by name.
  it("rejects the impersonation toolkit", () => {
    expect(validateUsername("mar​ta"), "zero-width space").not.toBeNull();
    expect(validateUsername("mаrta"), "Cyrillic a").not.toBeNull();
    expect(validateUsername("marta cooks"), "spaces").not.toBeNull();
    expect(validateUsername("marta\ncooks"), "newline").not.toBeNull();
    expect(validateUsername("<script>"), "markup").not.toBeNull();
  });

  it("will not start with a separator", () => {
    for (const name of ["_marta", ".marta", "-marta"]) {
      expect(validateUsername(name)).not.toBeNull();
    }
  });

  it("measures the trimmed name", () => {
    expect(validateUsername("  marta  ")).toBeNull();
  });
});

describe("validateEmail", () => {
  it.each(["a@b.com", "first.last@sub.example.co.uk", "x+tag@y.dev"])("accepts %s", (email) => {
    expect(validateEmail(email)).toBeNull();
  });

  it.each(["nope", "a@b", "a b@c.com", "@b.com", "a@.com", "a@b."])("rejects %o", (email) => {
    expect(validateEmail(email)).not.toBeNull();
  });

  it("caps the length at what an address may actually be", () => {
    expect(validateEmail(`${"a".repeat(250)}@b.com`)).toMatch(/too long/);
  });
});

describe("validatePassword", () => {
  it("accepts a reasonable one", () => {
    expect(validatePassword("correct horse battery")).toBeNull();
  });

  it("has a floor", () => {
    expect(validatePassword("short")).toMatch(/at least 6/);
    expect(validatePassword("")).toMatch(/required/);
  });

  // Not a strength rule: bcrypt reads 72 bytes and ignores the rest, so a
  // longer one is not stronger - but hashing it still costs, and the body
  // can hold a hundred kilobytes of it.
  it("has a ceiling", () => {
    expect(validatePassword("a".repeat(MAX_PASSWORD_LENGTH))).toBeNull();
    expect(validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1))).toMatch(/or fewer/);
  });
});
