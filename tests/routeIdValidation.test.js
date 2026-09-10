// ESM hoists static imports above assignments, so the environment has to be
// set before importing anything that reads it while loading.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-route-id-validation";

import { describe, it, expect, beforeAll } from "vitest";

// A malformed id reaches mongoose as a CastError. Express 5 forwards a
// rejected async handler to the error middleware, so an id that is not an
// id came back as 500 "the server is broken" rather than 400 "you asked
// for something that cannot exist" - and, with monitoring on, as an
// exception in the dashboard for every bot walking the URL space.
//
// The per-handler tests cover the recipe routes in detail. This one walks
// every mounted route instead, so a route added later without a guard is
// caught here rather than in production.

const MOUNTS = [
  ["/api/users", "../routes/userRoutes.js"],
  ["/api/users", "../routes/followRoutes.js"],
  ["/api/users", "../routes/blockRoutes.js"],
  ["/api/recipes", "../routes/recipeRoutes.js"],
  ["/api/comments", "../routes/commentRoutes.js"],
  ["/api/notifications", "../routes/notificationRoutes.js"],
  ["/api/reports", "../routes/reportRoutes.js"],
  ["/api/conversations", "../routes/conversationRoutes.js"],
];

// Only params that are meant to hold an ObjectId. `:tag` is a word.
const isIdParam = (name) => name === "id" || /Id$/.test(name);

let request;
let app;
let token;
let idRoutes;

beforeAll(async () => {
  const express = (await import("express")).default;
  request = (await import("supertest")).default;
  const jwt = (await import("jsonwebtoken")).default;
  const mongoose = (await import("mongoose")).default;
  const User = (await import("../models/User.js")).default;
  const { errorHandler, notFound } = await import("../middleware/errorMiddleware.js");

  // A signed-in caller who exists, so protect() lets the request through
  // and the handler itself is what the assertion is about.
  const me = new mongoose.Types.ObjectId().toString();
  User.findById = () => ({ select: () => ({ lean: async () => ({ _id: me, username: "probe" }) }) });
  token = jwt.sign({ id: me }, process.env.JWT_SECRET);

  app = express();
  app.use(express.json());
  const routes = [];
  for (const [base, path] of MOUNTS) {
    const router = (await import(path)).default;
    app.use(base, router);
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({ method, path: base + layer.route.path });
      }
    }
  }
  app.use(notFound);
  app.use(errorHandler);

  const seen = new Set();
  idRoutes = [];
  for (const route of routes) {
    const params = [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    if (!params.length || !params.every(isIdParam)) continue;
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    idRoutes.push(route);
  }
});

// There is no database here on purpose: mongoose casts before it needs a
// connection, so a handler that queries with junk rejects immediately,
// while one that guards first answers without ever reaching the driver.
const JUNK = "not-an-id";

describe("every route taking an id", () => {
  it("is discovered, so this test cannot pass by finding nothing", () => {
    expect(idRoutes.length).toBeGreaterThan(20);
  });

  it("answers a malformed id without a server error", async () => {
    const failures = [];
    for (const route of idRoutes) {
      const url = route.path.replace(/:(\w+)/g, JUNK);
      const res = await request(app)[route.method](url)
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "hi", reason: "spam", targetType: "recipe", targetId: JUNK });
      if (res.status >= 500) {
        failures.push(`${route.method.toUpperCase()} ${route.path} -> ${res.status} ${res.body?.message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 30000);

  it("says the request was bad rather than guessing at not-found", async () => {
    const wrong = [];
    for (const route of idRoutes) {
      const url = route.path.replace(/:(\w+)/g, JUNK);
      const res = await request(app)[route.method](url)
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "hi", reason: "spam", targetType: "recipe", targetId: JUNK });
      if (res.status !== 400) wrong.push(`${route.method.toUpperCase()} ${route.path} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 30000);
});
