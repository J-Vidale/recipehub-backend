import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { readFile } from "node:fs/promises";

// writeLimiter deliberately leaves reads alone, on the grounds that reads
// are cheap. Search is the read that is not: a case-insensitive substring
// match cannot use an index, so each call scans the whole recipe and user
// collections, and the navbar fires one on every keystroke. Unlimited,
// that is a free way to hold a small database down.

let searchLimiter;
beforeAll(async () => {
  ({ searchLimiter } = await import("../middleware/rateLimiters.js"));
});

let addressCounter = 0;
const freshAddress = () => `198.51.100.${(addressCounter += 1)}`;

const appWithLimiter = () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(searchLimiter);
  app.get("/search", (req, res) => res.json({ recipes: [], users: [] }));
  return app;
};

describe("searchLimiter", () => {
  it("lets ordinary typing through", async () => {
    const app = appWithLimiter();
    const address = freshAddress();
    // A word typed letter by letter, several times over, well inside the
    // budget - the limit must not get in a real user's way.
    for (let i = 0; i < 60; i += 1) {
      const res = await request(app).get("/search?q=chicken").set("X-Forwarded-For", address);
      expect(res.status).toBe(200);
    }
  });

  it("stops a burst that is not typing", async () => {
    const app = appWithLimiter();
    const address = freshAddress();
    let blocked = null;
    for (let i = 0; i < 130 && !blocked; i += 1) {
      const res = await request(app).get("/search?q=x").set("X-Forwarded-For", address);
      if (res.status === 429) blocked = res;
    }
    expect(blocked, "the burst was never stopped").not.toBeNull();
    expect(blocked.body.message).toMatch(/slow down/i);
  });

  it("counts each address separately", async () => {
    const app = appWithLimiter();
    const busy = freshAddress();
    for (let i = 0; i < 125; i += 1) {
      await request(app).get("/search?q=x").set("X-Forwarded-For", busy);
    }
    const other = await request(app).get("/search?q=x").set("X-Forwarded-For", freshAddress());
    expect(other.status, "one noisy address locked out everyone else").toBe(200);
  });
});

describe("the search route", () => {
  it("actually mounts the limiter, not just exports it", async () => {
    const source = await readFile(new URL("../routes/searchRoutes.js", import.meta.url), "utf8");
    expect(source).toMatch(/router\.get\(\s*"\/",\s*searchLimiter,\s*search\s*\)/);
  });
});
