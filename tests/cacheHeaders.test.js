import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

// server.js connects to MongoDB on import, so the middleware is rebuilt
// here from the same definition rather than booting the whole app. The
// last test in this file asserts this copy has not drifted from the real
// one, and reviewFixes.test.js covers the status-aware behaviour.
const publicReadCache = (seconds) => (req, res, next) => {
  if (req.method !== "GET") return next();
  const originalWriteHead = res.writeHead;
  res.writeHead = function patchedWriteHead(...args) {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      res.setHeader(
        "Cache-Control",
        `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`
      );
    }
    return originalWriteHead.apply(this, args);
  };
  next();
};

const app = express();
app.use("/cached", publicReadCache(600));
app.get("/cached/thing", (req, res) => res.json({ ok: true }));
app.post("/cached/thing", (req, res) => res.json({ ok: true }));
app.get("/uncached/thing", (req, res) => res.json({ ok: true }));

describe("public read caching", () => {
  it("lets a browser and any CDN reuse a GET for the stated window", async () => {
    const res = await request(app).get("/cached/thing");
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=600, stale-while-revalidate=1200"
    );
  });

  it("does not cache a write to the same path", async () => {
    const res = await request(app).post("/cached/thing");
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("leaves everything else uncached", async () => {
    const res = await request(app).get("/uncached/thing");
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

describe("which routes carry it in server.js", () => {
  it("caches only the public read-only endpoints", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../server.js", import.meta.url), "utf8");

    // These three are public, read-only and slow-moving.
    expect(source).toMatch(/app\.use\("\/api\/tags", publicReadCache\(\d+\)/);
    expect(source).toMatch(/app\.use\("\/api\/categories", publicReadCache\(\d+\)/);
    expect(source).toMatch(/app\.use\("\/api\/meals", publicReadCache\(\d+\)/);

    // These are per-user or written to, and must never be cached publicly:
    // a shared cache could hand one reader another reader's response.
    for (const route of [
      "/api/users",
      "/api/recipes",
      "/api/conversations",
      "/api/notifications",
      "/api/auth",
      "/api/reports",
      "/api/comments",
    ]) {
      const line = source.match(new RegExp(`app\\.use\\("${route}".*`, "g")) || [];
      for (const match of line) {
        expect(match).not.toMatch(/publicReadCache/);
      }
    }
  });
});

describe("this file's copy has not drifted from server.js", () => {
  it("matches the real middleware", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
    // The behaviour that matters: the header is decided at writeHead, once
    // the status is known, and only for a non-error response.
    expect(source).toMatch(/res\.writeHead = function patchedWriteHead/);
    expect(source).toMatch(/res\.statusCode >= 200 && res\.statusCode < 400/);
    expect(source).not.toMatch(/if \(req\.method === "GET"\) \{\s*res\.set\("Cache-Control"/);
  });
});
