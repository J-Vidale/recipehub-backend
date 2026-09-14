import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Like from "../models/Like.js";
import Share from "../models/Share.js";
import Block from "../models/Block.js";
import { likeRecipe } from "../controllers/likeController.js";
import { shareRecipe } from "../controllers/shareController.js";

// Blocking stopped messaging, commenting and following, and nothing else.
// Liking and sharing were open - and liking notifies the recipe's owner,
// so a blocked person could put their name in someone's notifications as
// often as they liked, by liking and unliking. That is precisely the thing
// blocking exists to stop, so the gap was the whole feature leaking.
//
// This walks the interactions that touch another person's content and
// asserts each one is closed, so an interaction added later is caught here.

const me = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();
const recipeId = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

afterEach(() => vi.restoreAllMocks());

const withBlock = (blocked) => {
  // isBlockedEitherWay does Block.findOne(...).select("_id").lean().
  vi.spyOn(Block, "findOne").mockReturnValue({
    select: () => ({ lean: async () => (blocked ? { _id: "b" } : null) }),
  });
  const recipe = { _id: recipeId, user: owner };
  vi.spyOn(Recipe, "findById").mockReturnValue(
    Object.assign(Promise.resolve(recipe), { lean: async () => recipe, select: () => ({ lean: async () => ({ shareCount: 0 }) }) })
  );
  vi.spyOn(Recipe, "updateOne").mockResolvedValue({});
};

const INTERACTIONS = [
  ["liking", likeRecipe, Like, /cannot like/i],
  ["sharing", shareRecipe, Share, /cannot share/i],
];

describe("what a blocked person can still do to your recipes", () => {
  it.each(INTERACTIONS)("%s is refused", async (_label, handler, Model, expected) => {
    withBlock(true);
    const create = vi.spyOn(Model, "create").mockResolvedValue({});
    const r = res();
    await handler({ params: { id: recipeId.toString() }, user: { _id: me } }, r);
    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(expected);
    expect(create, "the interaction went through anyway").not.toHaveBeenCalled();
  });

  it.each(INTERACTIONS)("%s still works when nobody is blocked", async (_label, handler, Model) => {
    withBlock(false);
    vi.spyOn(Model, "create").mockResolvedValue({});
    vi.spyOn(Recipe, "findByIdAndUpdate").mockResolvedValue({ likeCount: 1 });
    const r = res();
    await handler({ params: { id: recipeId.toString() }, user: { _id: me } }, r);
    expect(r.statusCode, JSON.stringify(r.body)).not.toBe(403);
  });
});

describe("the block check itself", () => {
  it("is present in every controller that touches another person's content", async () => {
    const { readFile } = await import("node:fs/promises");
    // Unblocking must stay open, so only the controllers that create an
    // interaction are listed.
    for (const file of [
      "likeController.js",
      "shareController.js",
      "commentController.js",
      "followController.js",
      "messageController.js",
    ]) {
      const source = await readFile(new URL(`../controllers/${file}`, import.meta.url), "utf8");
      expect(source, `${file} does not check for a block`).toMatch(/isBlockedEitherWay/);
    }
  });
});
