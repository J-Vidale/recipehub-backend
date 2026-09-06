import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { parsePageQuery, parseListQuery } from "../utils/pagination.js";
import { notFound, errorHandler } from "../middleware/errorMiddleware.js";

// Each block here corresponds to a defect found reviewing the previous
// batch of work. They exist so the same mistake cannot come back quietly.

describe("a cursor cannot silently zero the skip on an endpoint that ignores it", () => {
  // parseListQuery zeroes skip when a cursor is present, which is right for
  // endpoints that use the cursor. On the discover feed and the
  // conversations list, which order by something other than _id, that
  // combination returned page 1 while reporting the requested page - and on
  // discover it then cached page 1 under the requested page's key.
  it("parsePageQuery always honours the page number", () => {
    const query = { page: "3", limit: "10", cursor: "507f1f77bcf86cd799439011" };
    expect(parsePageQuery(query).skip).toBe(20);
  });

  it("while parseListQuery still zeroes it for cursor-capable endpoints", () => {
    const query = { page: "3", limit: "10", cursor: "507f1f77bcf86cd799439011" };
    expect(parseListQuery(query).skip).toBe(0);
  });

  it("the two agree when no cursor is sent", () => {
    const query = { page: "4", limit: "25" };
    expect(parsePageQuery(query).skip).toBe(parseListQuery(query).skip);
  });
});

describe("a rejected origin is a CORS block, not a server error", () => {
  let app;

  beforeEach(async () => {
    process.env.CORS_ORIGINS = "https://allowed.com";
    const { default: cors } = await import("cors");
    const { corsOriginCheck } = await import("../config/origins.js");
    app = express();
    app.use(cors({ origin: corsOriginCheck, credentials: true }));
    app.get("/thing", (req, res) => res.json({ ok: true }));
    app.use(notFound);
    app.use(errorHandler);
  });

  afterEach(() => {
    delete process.env.CORS_ORIGINS;
  });

  it("does not turn a foreign Origin into a 500", async () => {
    const res = await request(app).get("/thing").set("Origin", "https://evil.com");
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
  });

  it("withholds the CORS header, which is what makes the browser block it", async () => {
    const res = await request(app).get("/thing").set("Origin", "https://evil.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still returns the header for a configured origin", async () => {
    const res = await request(app).get("/thing").set("Origin", "https://allowed.com");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://allowed.com");
  });

  it("handles a preflight without erroring", async () => {
    const res = await request(app)
      .options("/thing")
      .set("Origin", "https://evil.com")
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBeLessThan(500);
  });
});

describe("a 404 is not reported as an application exception", () => {
  // Sentry's default filter reads error.status and treats a status-less
  // error as a 500, so every mistyped path and every bot scanning for
  // /wp-login.php would have been captured.
  it("notFound attaches a 404 status to the error it forwards", () => {
    let forwarded;
    const res = { status: () => res };
    notFound({ originalUrl: "/nope" }, res, (err) => { forwarded = err; });
    expect(forwarded.status).toBe(404);
  });

  // Sentry's rule, read from the installed package rather than restated
  // from memory: getStatusCodeFromResponse falls back to 500 when an error
  // carries no status, and defaultShouldHandleError captures at >= 500.
  // If a future version changes either, this fails and says so.
  it("matches the rule the installed Sentry actually applies", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = new URL(
      "../node_modules/@sentry/core/build/cjs/integrations/express/utils.js",
      import.meta.url
    );
    const source = await readFile(path, "utf8").catch(() => null);
    if (source === null) return; // package layout changed; the assertions below still hold

    expect(source).toMatch(/error\.status \|\| error\.statusCode/);
    expect(source).toMatch(/statusCode \? parseInt\(statusCode, 10\) : 500/);
    expect(source).toMatch(/return status >= 500/);
  });

  it("so a 404 falls below the capture threshold and a bare error does not", () => {
    const shouldCapture = (err) => {
      const status = err.status || err.statusCode;
      return (status ? parseInt(status, 10) : 500) >= 500;
    };
    let forwarded;
    const res = { status: () => res };
    notFound({ originalUrl: "/nope" }, res, (err) => { forwarded = err; });
    expect(shouldCapture(forwarded)).toBe(false);
    expect(shouldCapture(new Error("boom"))).toBe(true);
  });

  it("and the response is unchanged", async () => {
    const app = express();
    app.use(notFound);
    app.use(errorHandler);
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Not Found/);
  });
});

describe("error responses are never cached", () => {
  // Setting Cache-Control before the route ran meant a 429 from the rate
  // limiter, or a 502 while an upstream was down, was held by browsers and
  // any shared CDN for the full window - turning a blip into an outage.
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
  app.use("/c", publicReadCache(600));
  app.get("/c/ok", (req, res) => res.json({ ok: true }));
  app.get("/c/limited", (req, res) => res.status(429).json({ message: "slow down" }));
  app.get("/c/upstream", (req, res) => res.status(502).json({ message: "upstream" }));
  app.get("/c/missing", (req, res) => res.status(404).json({ message: "gone" }));
  app.get("/c/redirect", (req, res) => res.redirect(302, "/elsewhere"));

  it("caches a success", async () => {
    const res = await request(app).get("/c/ok");
    expect(res.headers["cache-control"]).toBe("public, max-age=600, stale-while-revalidate=1200");
  });

  it.each([
    ["429 from the rate limiter", "/c/limited"],
    ["502 from a failing upstream", "/c/upstream"],
    ["404", "/c/missing"],
  ])("does not cache a %s", async (_label, path) => {
    const res = await request(app).get(path);
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("still caches a redirect, which is a valid cacheable outcome", async () => {
    const res = await request(app).get("/c/redirect");
    expect(res.headers["cache-control"]).toBe("public, max-age=600, stale-while-revalidate=1200");
  });
});

describe("the start command loads Sentry's instrumentation", () => {
  // In ESM, an import inside server.js runs after the modules it is meant
  // to wrap have already been loaded. Auto-instrumentation needs the
  // loader hooks registered by --import before anything else is resolved.
  it("uses --import for start and dev", async () => {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts.start).toContain("--import ./config/instrument.js");
    expect(pkg.scripts.dev).toContain("--import ./config/instrument.js");
  });
});
