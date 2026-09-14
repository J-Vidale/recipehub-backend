import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import User from "../models/User.js";
import Follow from "../models/Follow.js";
import {
  getAllRecipes,
  getFollowingFeed,
  getSingleRecipe,
  deleteRecipe,
  getSavedRecipes,
  saveRecipe,
  unsaveRecipe,
} from "../controllers/recipeController.js";
import { loginUser } from "../controllers/authController.js";

// Sentry is wired to the Express error middleware, and nothing else. A
// handler that catches its own failure and answers `res.status(500)` never
// reaches that middleware, so the failure is invisible: the busiest
// endpoints in the app - the home feed, the following feed, a recipe page,
// and login - could fail for everyone and report nothing.
//
// Express 5 forwards a rejected handler to the error middleware on its
// own, which is what the newer handlers here already rely on. These assert
// the older ones now do the same: the failure propagates instead of being
// turned into a response on the spot.

const userId = new mongoose.Types.ObjectId();
const recipeId = new mongoose.Types.ObjectId();
const boom = () => new Error("the database is down");

const res = () => ({
  statusCode: 200,
  body: null,
  status: vi.fn(function status(code) { this.statusCode = code; return this; }),
  json: vi.fn(function json(payload) { this.body = payload; return this; }),
});

afterEach(() => vi.restoreAllMocks());

// Each entry fails the first database call the handler makes.
const HANDLERS = [
  ["the home feed", getAllRecipes, () => {
    vi.spyOn(Recipe, "find").mockImplementation(() => { throw boom(); });
  }, { query: { sort: "newest" } }],

  ["the following feed", getFollowingFeed, () => {
    vi.spyOn(Follow, "find").mockReturnValue({ distinct: async () => { throw boom(); } });
  }, { query: {}, user: { _id: userId } }],

  ["a recipe page", getSingleRecipe, () => {
    vi.spyOn(Recipe, "findById").mockReturnValue({
      populate: () => ({ lean: async () => { throw boom(); } }),
    });
  }, { params: { id: recipeId.toString() } }],

  ["deleting a recipe", deleteRecipe, () => {
    vi.spyOn(Recipe, "findById").mockReturnValue({ lean: async () => { throw boom(); } });
  }, { params: { id: recipeId.toString() }, user: { _id: userId } }],

  ["the saved list", getSavedRecipes, () => {
    vi.spyOn(User, "findById").mockReturnValue({
      populate: () => ({ lean: async () => { throw boom(); } }),
    });
  }, { user: { _id: userId } }],

  ["saving a recipe", saveRecipe, () => {
    vi.spyOn(Recipe, "exists").mockRejectedValue(boom());
  }, { params: { recipeId: recipeId.toString() }, user: { _id: userId } }],

  ["unsaving a recipe", unsaveRecipe, () => {
    vi.spyOn(User, "updateOne").mockRejectedValue(boom());
  }, { params: { recipeId: recipeId.toString() }, user: { _id: userId } }],

  ["logging in", loginUser, () => {
    vi.spyOn(User, "findOne").mockImplementation(() => { throw boom(); });
  }, { body: { username: "someone", password: "a-password" } }],
];

describe("a database failure inside a handler", () => {
  it.each(HANDLERS)("%s lets the error reach the error middleware", async (
    _label,
    handler,
    breakIt,
    request
  ) => {
    breakIt();
    const r = res();

    await expect(handler(request, r)).rejects.toThrow(/database is down/);
    expect(
      r.status,
      "the handler answered on its own, so Sentry never saw the failure"
    ).not.toHaveBeenCalled();
  });
});

describe("the handlers that do answer a failure themselves", () => {
  it("report it to Sentry, because the error middleware will not see it", async () => {
    const { readFile } = await import("node:fs/promises");
    // Cloudinary failures are answered on the spot so the caller learns
    // which half failed (a 502, not a generic 500). That is deliberate -
    // and it is exactly the case that needs reporting by hand.
    for (const file of ["mediaController.js", "userController.js"]) {
      const source = await readFile(new URL(`../controllers/${file}`, import.meta.url), "utf8");
      const catches = source.split(/\} catch \(err\) \{/).slice(1);
      for (const block of catches) {
        const body = block.slice(0, block.indexOf("\n  }"));
        if (!/res\.status\(5\d\d\)/.test(body)) continue;
        expect(body, `a 5xx answered in ${file} without reporting it`).toMatch(/captureError/);
      }
    }
  });

  it("is the only place left that turns a failure into a 5xx", async () => {
    const { readFile } = await import("node:fs/promises");
    const { readdir } = await import("node:fs/promises");
    const dir = new URL("../controllers/", import.meta.url);
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".js")) continue;
      const source = await readFile(new URL(file, dir), "utf8");
      for (const block of source.split(/\} catch \(err\) \{/).slice(1)) {
        const body = block.slice(0, block.indexOf("\n  }"));
        if (!/res\.status\(5\d\d\)/.test(body)) continue;
        expect(
          ["mediaController.js", "userController.js"],
          `${file} swallows a failure into a 5xx; either re-throw it or report it`
        ).toContain(file);
      }
    }
  });
});
