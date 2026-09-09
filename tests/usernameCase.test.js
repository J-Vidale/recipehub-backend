import { describe, it, expect } from "vitest";
import User, { CASE_INSENSITIVE } from "../models/User.js";

// No live database here, so these check the two things that decide the
// behaviour: the index MongoDB is asked to build, and the collation the
// queries carry. A query without the collation reads case-sensitively
// however the index is built, and an index without it lets two accounts
// exist however the queries read - so both have to be asserted.

describe("the username index", () => {
  const indexes = User.schema.indexes();
  const usernameIndex = indexes.find(([fields]) => fields.username === 1);

  it("exists and is unique", () => {
    expect(usernameIndex, "no index on username").toBeDefined();
    expect(usernameIndex[1].unique).toBe(true);
  });

  it("ignores case", () => {
    expect(usernameIndex[1].collation).toEqual(CASE_INSENSITIVE);
    expect(CASE_INSENSITIVE.strength).toBe(2);
  });

  // Strength 1 would also fold accents together, making "jose" and "José"
  // the same account.
  it("does not ignore accents", () => {
    expect(CASE_INSENSITIVE.strength).not.toBe(1);
  });

  // A second, case-sensitive unique index would still allow Marta and
  // marta: uniqueness is only as strong as the loosest index enforcing it
  // is... but a case-sensitive one is simply redundant here, and two
  // unique indexes on one field is a trap for the next reader.
  it("is the only unique index on username", () => {
    const uniqueOnUsername = indexes.filter(
      ([fields, options]) => fields.username === 1 && options?.unique
    );
    expect(uniqueOnUsername).toHaveLength(1);
    expect(User.schema.path("username").options.unique).toBeUndefined();
  });
});

describe("the queries that look a username up", () => {
  const collationOf = (query) => query.getOptions().collation;

  it("is carried by the login lookup", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../controllers/authController.js", import.meta.url), "utf8");
    // Both lookups by username, and only those, go through the collation.
    const usernameLookups = source
      .split(/\n\s*\n/)
      .filter((block) => /findOne\(\{\s*username/.test(block));
    expect(usernameLookups.length).toBe(2);
    for (const block of usernameLookups) {
      expect(block).toMatch(/\.collation\(CASE_INSENSITIVE\)/);
    }
  });

  it("actually reaches the driver as a collation option", () => {
    const query = User.findOne({ username: "Marta" }).collation(CASE_INSENSITIVE);
    expect(collationOf(query)).toEqual({ locale: "en", strength: 2 });
  });

  // The email lookup does not need one: the field is lower-cased on the
  // way in and the controller lower-cases what it searches for.
  it("is not needed for email, which is stored folded", () => {
    expect(User.schema.path("email").options.lowercase).toBe(true);
  });
});
