import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const SECRET = "test-secret-that-is-long-enough-to-be-real";
process.env.JWT_SECRET = SECRET;

// Imported after the secret is set: the limiter verifies tokens with it.
let writeLimiter;
let uploadLimiter;

beforeAll(async () => {
  ({ writeLimiter, uploadLimiter } = await import("../middleware/rateLimiters.js"));
});

const tokenFor = (id) => jwt.sign({ id }, SECRET);

const appWith = (limiter) => {
  const app = express();
  // Mirrors server.js: one proxy hop, so X-Forwarded-For is the client.
  app.set("trust proxy", 1);
  app.use(limiter);
  app.all("/thing", (req, res) => res.json({ ok: true }));
  return app;
};

// Each test uses its own address or account so the shared in-memory store
// cannot leak counts between them.
let addressCounter = 0;
const freshAddress = () => `203.0.113.${(addressCounter += 1)}`;

const send = (app, { method = "post", token, address }) => {
  const req = request(app)[method]("/thing").set("X-Forwarded-For", address);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
};

describe("writeLimiter", () => {
  it("lets reads through however many there are", async () => {
    const app = appWith(writeLimiter);
    const address = freshAddress();
    for (let i = 0; i < 70; i += 1) {
      const res = await send(app, { method: "get", address });
      expect(res.status).toBe(200);
    }
  });

  it("stops a burst of writes from one account", async () => {
    const app = appWith(writeLimiter);
    const token = tokenFor("64f1c0de00000000000000a1");
    const address = freshAddress();

    let lastOk = 0;
    let blocked = null;
    for (let i = 0; i < 61; i += 1) {
      const res = await send(app, { token, address });
      if (res.status === 200) lastOk += 1;
      else blocked = res;
    }

    expect(lastOk).toBe(60);
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/too quickly/i);
  });

  // The reason the key is the account and not the address: a household, an
  // office or a mobile carrier's NAT all share one.
  it("gives each account its own budget from the same address", async () => {
    const app = appWith(writeLimiter);
    const address = freshAddress();
    const first = tokenFor("64f1c0de00000000000000b1");
    const second = tokenFor("64f1c0de00000000000000b2");

    for (let i = 0; i < 60; i += 1) {
      await send(app, { token: first, address });
    }
    expect((await send(app, { token: first, address })).status).toBe(429);
    expect((await send(app, { token: second, address })).status).toBe(200);
  });

  // And the reason it is verified rather than read: otherwise the key is
  // a header, and a fresh bucket is one edit away.
  it("does not hand a fresh budget to a forged token", async () => {
    const app = appWith(writeLimiter);
    const address = freshAddress();
    const forged = jwt.sign({ id: "64f1c0de00000000000000c1" }, "not-the-real-secret");

    for (let i = 0; i < 60; i += 1) {
      await send(app, { address });
    }
    // Falls back to the address, which is already spent.
    expect((await send(app, { token: forged, address })).status).toBe(429);
  });

  it("limits logged-out writes by address", async () => {
    const app = appWith(writeLimiter);
    const spent = freshAddress();
    for (let i = 0; i < 60; i += 1) await send(app, { address: spent });

    expect((await send(app, { address: spent })).status).toBe(429);
    expect((await send(app, { address: freshAddress() })).status).toBe(200);
  });

  it("reports the limit in standard headers, not the legacy ones", async () => {
    const app = appWith(writeLimiter);
    const res = await send(app, { address: freshAddress() });
    expect(res.headers["ratelimit-policy"] ?? res.headers["ratelimit"]).toBeDefined();
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});

describe("uploadLimiter", () => {
  it("is stricter than the general write limit", async () => {
    const app = appWith(uploadLimiter);
    const address = freshAddress();
    let allowed = 0;
    for (let i = 0; i < 31; i += 1) {
      if ((await send(app, { address })).status === 200) allowed += 1;
    }
    expect(allowed).toBe(30);
  });
});

describe("server.js has not drifted from this", () => {
  it("applies the write limiter before the body parsers", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
    const limiterAt = source.indexOf("app.use(writeLimiter)");
    const jsonAt = source.indexOf("app.use(express.json())");
    expect(limiterAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeLessThan(jsonAt);
  });

  it("puts the upload limiter in front of the two upload routes", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of ["routes/recipeRoutes.js", "routes/userRoutes.js"]) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
      const uploadRoutes = source
        .split("\n")
        .filter((line) => /router\.(post|put)\(.*upload(SingleMedia|SingleImage)/.test(line));
      expect(uploadRoutes.length).toBeGreaterThan(0);
      for (const line of uploadRoutes) expect(line).toContain("uploadLimiter");
    }
  });
});
