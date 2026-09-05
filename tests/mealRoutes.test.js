import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import nock from "nock";
import mealRoutes from "../routes/mealRoutes.js";

const app = express();
app.use("/api/meals", mealRoutes);

// Records the path TheMealDB actually received, which is the only way to
// prove the search term was escaped rather than spliced into the URL.
let seenPaths = [];

beforeEach(() => {
  seenPaths = [];
  nock.cleanAll();
  nock("https://www.themealdb.com")
    .persist()
    .get(/.*/)
    .reply(function () {
      seenPaths.push(this.req.path);
      return [200, { meals: [{ idMeal: "1", strMeal: "Test" }] }];
    });
});

afterAll(() => {
  nock.cleanAll();
  nock.restore();
});

describe("input validation", () => {
  it("requires a search term", async () => {
    const res = await request(app).get("/api/meals");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/search term/i);
  });

  it("rejects a blank term", async () => {
    const res = await request(app).get("/api/meals?search=%20%20");
    expect(res.status).toBe(400);
  });

  it("rejects a repeated parameter, which arrives as an array", async () => {
    const res = await request(app).get("/api/meals?search=a&search=b");
    expect(res.status).toBe(400);
  });

  it("rejects an over-long term", async () => {
    const res = await request(app).get(`/api/meals?search=${"x".repeat(200)}`);
    expect(res.status).toBe(400);
  });
});

describe("the upstream URL is built safely", () => {
  it("passes an ordinary term through", async () => {
    await request(app).get("/api/meals?search=chicken");
    expect(seenPaths.at(-1)).toBe("/api/json/v1/1/search.php?s=chicken");
  });

  it("does not let a term append its own upstream parameters", async () => {
    await request(app).get(`/api/meals?search=${encodeURIComponent("chicken&c=Dessert")}`);
    expect(seenPaths.at(-1)).not.toMatch(/&c=Dessert/);
    expect(seenPaths.at(-1)).toMatch(/^\/api\/json\/v1\/1\/search\.php\?s=/);
  });

  it("does not let a term walk the upstream path", async () => {
    await request(app).get(`/api/meals?search=${encodeURIComponent("../../../lookup.php?i=52772")}`);
    expect(seenPaths.at(-1)).toMatch(/^\/api\/json\/v1\/1\/search\.php\?s=/);
    expect(seenPaths.at(-1)).not.toMatch(/lookup\.php\?i=/);
  });

  it("handles spaces and accents", async () => {
    await request(app).get(`/api/meals?search=${encodeURIComponent("crème brûlée")}`);
    expect(seenPaths.at(-1)).toMatch(/^\/api\/json\/v1\/1\/search\.php\?s=cr%C3%A8me/);
  });
});

describe("responses", () => {
  it("returns the meals array", async () => {
    const res = await request(app).get("/api/meals?search=chicken");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].strMeal).toBe("Test");
  });

  it("returns an empty array when the upstream says null", async () => {
    nock.cleanAll();
    nock("https://www.themealdb.com").get(/.*/).reply(200, { meals: null });
    const res = await request(app).get("/api/meals?search=zzzz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("reports a 502 when the upstream fails", async () => {
    nock.cleanAll();
    nock("https://www.themealdb.com").get(/.*/).reply(500, "upstream is unwell");
    const res = await request(app).get("/api/meals?search=chicken");
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Failed to fetch/i);
  });
});
