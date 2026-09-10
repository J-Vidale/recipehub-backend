import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import Like from "../models/Like.js";
import Share from "../models/Share.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { deleteRecipe } from "../controllers/recipeController.js";

// Deleting a recipe used to clear everything hanging off it and remove the
// recipe row last, with the Cloudinary round trips before all of it. For
// that whole stretch the recipe was still there to be found, so it was
// still likeable, savable, commentable and shareable - and anything
// arriving after its own cascade step had passed survived as an orphan. A
// save landing after the $pull left a phantom entry in someone's saved
// list, pointing at a recipe that no longer existed.
//
// Every one of those paths starts by looking the recipe up and answers 404
// when it is gone, so the row going first closes the window for all of
// them. This pins the ordering, because nothing else would notice it
// moving back.

const userId = new mongoose.Types.ObjectId();
const recipeId = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

afterEach(() => vi.restoreAllMocks());

const run = async () => {
  const order = [];
  const note = (label) => () => { order.push(label); return Promise.resolve({}); };

  vi.spyOn(Recipe, "findById").mockReturnValue({
    lean: async () => ({ _id: recipeId, user: userId, media: [{ publicId: "p1", type: "image" }] }),
  });
  vi.spyOn(Comment, "find").mockReturnValue({ distinct: async () => [] });
  vi.spyOn(Recipe, "deleteOne").mockImplementation(note("recipe"));
  vi.spyOn(CommentLike, "deleteMany").mockImplementation(note("commentLikes"));
  vi.spyOn(Like, "deleteMany").mockImplementation(note("likes"));
  vi.spyOn(Share, "deleteMany").mockImplementation(note("shares"));
  vi.spyOn(Comment, "deleteMany").mockImplementation(note("comments"));
  vi.spyOn(Notification, "deleteMany").mockImplementation(note("notifications"));
  vi.spyOn(User, "updateMany").mockImplementation(note("savedRecipes"));

  const r = res();
  await deleteRecipe({ params: { id: recipeId.toString() }, user: { _id: userId } }, r);
  return { order, r };
};

describe("deleting a recipe", () => {
  it("removes the recipe row before anything that hangs off it", async () => {
    const { order, r } = await run();
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(order[0]).toBe("recipe");
  });

  it("still clears every dependent record", async () => {
    const { order } = await run();
    expect(order.slice(1).sort()).toEqual(
      ["commentLikes", "comments", "likes", "notifications", "savedRecipes", "shares"].sort()
    );
  });

  it("does not leave the recipe behind if a cascade step fails", async () => {
    const { order } = await run();
    // The row is gone first, so a later failure leaves orphans to sweep
    // rather than a recipe whose likes and comments have been taken away
    // underneath it while it is still on the site.
    expect(order.indexOf("recipe")).toBeLessThan(order.indexOf("likes"));
    expect(order.indexOf("recipe")).toBeLessThan(order.indexOf("savedRecipes"));
  });
});
