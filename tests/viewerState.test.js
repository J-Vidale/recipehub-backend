import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import Like from "../models/Like.js";
import Share from "../models/Share.js";
import CommentLike from "../models/CommentLike.js";
import Follow from "../models/Follow.js";
import { getSingleRecipe, getFollowingFeed } from "../controllers/recipeController.js";
import { getComments } from "../controllers/commentController.js";
import { likedRecipeIds, sharedRecipeIds, likedCommentIds } from "../utils/viewerState.js";
import recipeRouter from "../routes/recipeRoutes.js";

// Nothing told the like and share buttons what this reader had already
// done, so every page load drew every heart empty and every recipe
// unshared. Clicking again did no damage - the unique index turns a repeat
// into a no-op - but the page was reporting the wrong thing, and the only
// way to find out was to click and watch the count correct itself.

const me = new mongoose.Types.ObjectId();
const recipeId = new mongoose.Types.ObjectId();
const otherRecipeId = new mongoose.Types.ObjectId();
const commentId = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

// Model.find(...).distinct(field)
const rowsFor = (Model, ids) =>
  vi.spyOn(Model, "find").mockReturnValue({ distinct: async () => ids });

afterEach(() => vi.restoreAllMocks());

describe("the lookup itself", () => {
  it.each([
    ["likes on recipes", likedRecipeIds, Like],
    ["shares", sharedRecipeIds, Share],
    ["likes on comments", likedCommentIds, CommentLike],
  ])("%s come back as a set of strings", async (_label, lookup, Model) => {
    rowsFor(Model, [recipeId]);
    const found = await lookup(me, [recipeId]);
    expect(found.has(String(recipeId))).toBe(true);
    expect(found.has(String(otherRecipeId))).toBe(false);
  });

  it.each([
    ["a logged-out reader", null, [recipeId]],
    ["an empty page", me, []],
  ])("costs no query for %s", async (_label, viewerId, ids) => {
    const find = vi.spyOn(Like, "find");
    const found = await likedRecipeIds(viewerId, ids);
    expect(found.size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});

describe("a recipe page", () => {
  const withRecipe = () =>
    vi.spyOn(Recipe, "findById").mockReturnValue({
      populate: () => ({ lean: async () => ({ _id: recipeId, title: "Soup", likeCount: 3 }) }),
    });

  it("says what this reader has already done", async () => {
    withRecipe();
    rowsFor(Like, [recipeId]);
    rowsFor(Share, []);

    const r = res();
    await getSingleRecipe({ params: { id: recipeId.toString() }, user: { _id: me } }, r);

    expect(r.body.likedByMe).toBe(true);
    expect(r.body.sharedByMe).toBe(false);
    expect(r.body.title, "the rest of the recipe still comes through").toBe("Soup");
  });

  it("answers false for both to a logged-out reader, without a lookup", async () => {
    withRecipe();
    const likes = vi.spyOn(Like, "find");
    const shares = vi.spyOn(Share, "find");

    const r = res();
    await getSingleRecipe({ params: { id: recipeId.toString() } }, r);

    expect(r.body.likedByMe).toBe(false);
    expect(r.body.sharedByMe).toBe(false);
    expect(likes).not.toHaveBeenCalled();
    expect(shares).not.toHaveBeenCalled();
  });
});

describe("the following feed", () => {
  it("marks the cards this reader has liked, in one lookup for the page", async () => {
    vi.spyOn(Follow, "find").mockReturnValue({ distinct: async () => [new mongoose.Types.ObjectId()] });
    vi.spyOn(Recipe, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ populate: () => ({ lean: async () => [
        { _id: recipeId, title: "Soup" },
        { _id: otherRecipeId, title: "Stew" },
      ] }) }) }),
    });
    const likes = rowsFor(Like, [recipeId]);

    const r = res();
    await getFollowingFeed({ query: {}, user: { _id: me } }, r);

    expect(r.body.recipes.map((recipe) => recipe.likedByMe)).toEqual([true, false]);
    expect(likes, "one query for the whole page, not one per card").toHaveBeenCalledTimes(1);
  });
});

describe("a recipe's comments", () => {
  it("marks the ones this reader has liked", async () => {
    vi.spyOn(Recipe, "findById").mockReturnValue({
      lean: async () => ({ _id: recipeId, pinnedComment: null }),
    });
    vi.spyOn(Comment, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ populate: () => ({ lean: async () => [
        { _id: commentId, text: "Made this twice." },
      ] }) }) }),
    });
    rowsFor(CommentLike, [commentId]);

    const r = res();
    await getComments({ params: { id: recipeId.toString() }, query: {}, user: { _id: me } }, r);

    expect(r.body[0].likedByMe).toBe(true);
    expect(r.body[0].text).toBe("Made this twice.");
  });
});

describe("the routes that carry the reader's identity", () => {
  it("let a token through without requiring one", () => {
    // optionalAuth, not protect: these stay public. Mounting protect here
    // would have signed-out visitors turned away from a recipe page.
    // router.route("/:id") puts get, put and delete in one route with a
    // single stack, and each handler in it carries the method it belongs
    // to - so this has to filter by method rather than read the stack
    // whole, or the put and delete branches' protect would be counted as
    // guarding the get.
    const handlersFor = (method, path) => {
      for (const layer of recipeRouter.stack) {
        if (layer.route?.path !== path) continue;
        const names = layer.route.stack
          .filter((handler) => handler.method === method)
          .map((handler) => handler.name);
        if (names.length) return names;
      }
      return [];
    };
    const named = new Map([
      ["GET /:id", handlersFor("get", "/:id")],
      ["GET /:id/comments", handlersFor("get", "/:id/comments")],
    ]);
    expect(named.get("GET /:id")).toContain("optionalAuth");
    expect(named.get("GET /:id")).not.toContain("protect");
    expect(named.get("GET /:id/comments")).toContain("optionalAuth");
    expect(named.get("GET /:id/comments")).not.toContain("protect");
  });
});
