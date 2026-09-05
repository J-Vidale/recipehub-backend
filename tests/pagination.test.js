import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { parseListQuery, withCursor, buildPage } from "../utils/pagination.js";

const oid = () => new mongoose.Types.ObjectId().toString();

describe("parseListQuery: limits", () => {
  it("falls back to the default when limit is missing or junk", () => {
    expect(parseListQuery({}).limit).toBe(20);
    expect(parseListQuery({ limit: "abc" }).limit).toBe(20);
    expect(parseListQuery({ limit: "0" }).limit).toBe(20);
    expect(parseListQuery({ limit: "-5" }).limit).toBe(20);
  });

  it("caps the limit so a client cannot ask for the whole collection", () => {
    expect(parseListQuery({ limit: "500" }).limit).toBe(50);
  });

  it("honours a caller-supplied default and cap", () => {
    expect(parseListQuery({}, 10, 25).limit).toBe(10);
    expect(parseListQuery({ limit: "100" }, 10, 25).limit).toBe(25);
  });
});

describe("parseListQuery: pages", () => {
  it("defaults to page 1 for missing or invalid input", () => {
    expect(parseListQuery({}).page).toBe(1);
    expect(parseListQuery({ page: "0" }).page).toBe(1);
    expect(parseListQuery({ page: "-3" }).page).toBe(1);
    expect(parseListQuery({ page: "abc" }).page).toBe(1);
  });

  it("computes skip from page and limit", () => {
    expect(parseListQuery({ page: "3", limit: "10" }).skip).toBe(20);
  });
});

describe("parseListQuery: cursors", () => {
  it("accepts a valid ObjectId", () => {
    const id = oid();
    expect(parseListQuery({ cursor: id }).cursor).toBe(id);
  });

  it("ignores a malformed cursor rather than erroring", () => {
    // A stale or hand-edited link should start from the top, not 400.
    expect(parseListQuery({ cursor: "not-an-id" }).cursor).toBeNull();
    expect(parseListQuery({ cursor: "" }).cursor).toBeNull();
    expect(parseListQuery({ cursor: 12345 }).cursor).toBeNull();
  });

  // Applying both would skip *within* the already-narrowed range and drop
  // documents silently, which is the classic way this refactor goes wrong.
  it("zeroes skip when a cursor is present, even if page is also sent", () => {
    const parsed = parseListQuery({ cursor: oid(), page: "5", limit: "10" });
    expect(parsed.skip).toBe(0);
  });

  it("still computes skip when the cursor is invalid and therefore ignored", () => {
    const parsed = parseListQuery({ cursor: "nope", page: "3", limit: "10" });
    expect(parsed.skip).toBe(20);
  });
});

describe("withCursor", () => {
  it("adds an _id filter for everything after the cursor", () => {
    const id = oid();
    expect(withCursor({ user: "u1" }, id)).toEqual({ user: "u1", _id: { $lt: id } });
  });

  it("returns the filter untouched when there is no cursor", () => {
    expect(withCursor({ user: "u1" }, null)).toEqual({ user: "u1" });
  });

  it("does not mutate the caller's filter", () => {
    const filter = { user: "u1" };
    withCursor(filter, oid());
    expect(filter).toEqual({ user: "u1" });
  });
});

describe("buildPage", () => {
  const docs = (n) => Array.from({ length: n }, () => ({ _id: new mongoose.Types.ObjectId() }));

  it("trims the extra lookahead document off the page", () => {
    const result = buildPage(docs(21), 20);
    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(true);
  });

  it("reports the last returned id as the next cursor", () => {
    const rows = docs(21);
    const result = buildPage(rows, 20);
    expect(result.nextCursor).toBe(String(rows[19]._id));
  });

  it("reports no more pages when the lookahead came back short", () => {
    const result = buildPage(docs(12), 20);
    expect(result.items).toHaveLength(12);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("handles an empty result without producing a cursor", () => {
    const result = buildPage([], 20);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("passes extra fields through to the response", () => {
    expect(buildPage(docs(1), 20, { tag: "curry" }).tag).toBe("curry");
  });
});

describe("walking a whole list with a cursor", () => {
  // Simulates the loop a client runs: fetch, take nextCursor, fetch again.
  // Every document must appear exactly once, which is the property the
  // skip-based version loses when rows are inserted mid-scroll.
  it("visits every document once, with no gaps or repeats", () => {
    const all = Array.from({ length: 47 }, () => ({ _id: new mongoose.Types.ObjectId() }))
      .sort((a, b) => (a._id > b._id ? -1 : 1)); // _id descending, as the queries sort

    const seen = [];
    let cursor = null;
    for (let guard = 0; guard < 20; guard++) {
      const filter = withCursor({}, cursor);
      const matching = filter._id ? all.filter((d) => String(d._id) < String(filter._id.$lt)) : all;
      const { items, hasMore, nextCursor } = buildPage(matching.slice(0, 11), 10);
      seen.push(...items.map((d) => String(d._id)));
      if (!hasMore) break;
      cursor = nextCursor;
    }

    expect(seen).toHaveLength(47);
    expect(new Set(seen).size).toBe(47);
    expect(seen).toEqual(all.map((d) => String(d._id)));
  });
});
