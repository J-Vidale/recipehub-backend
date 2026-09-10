import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import Notification from "../models/Notification.js";
import { deleteComment } from "../controllers/commentController.js";

// Two bugs, same handler.
//
// The cascade removed a comment's likes before the comment itself, and
// liking a comment only checks that the comment exists - so a like arriving
// between those two writes outlived the cascade as an orphan. The rows go
// first now, which closes the window.
//
// And the count decrement used the number of comments found a moment
// earlier. Two deletes racing on the same comment both saw the same list
// and both subtracted its length, taking commentCount down twice for one
// deletion. It now subtracts what deleteMany actually removed.

const userId = new mongoose.Types.ObjectId();
const recipeId = new mongoose.Types.ObjectId();
const commentId = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

afterEach(() => vi.restoreAllMocks());

const run = async ({ deletedCount = 1, replies = [], pinned = null } = {}) => {
  const order = [];
  const updates = [];

  vi.spyOn(Recipe, "findById").mockReturnValue({
    lean: async () => ({ _id: recipeId, user: userId, pinnedComment: pinned }),
  });
  vi.spyOn(Comment, "findById").mockReturnValue({
    lean: async () => ({ _id: commentId, recipe: recipeId, user: userId }),
  });
  vi.spyOn(Comment, "find").mockReturnValue({ lean: async () => replies });
  vi.spyOn(Comment, "deleteMany").mockImplementation(async () => {
    order.push("comments");
    return { deletedCount };
  });
  vi.spyOn(CommentLike, "deleteMany").mockImplementation(async () => {
    order.push("commentLikes");
    return {};
  });
  vi.spyOn(Notification, "deleteMany").mockImplementation(async () => {
    order.push("notifications");
    return {};
  });
  vi.spyOn(Recipe, "updateOne").mockImplementation(async (filter, update) => {
    order.push("count");
    updates.push({ filter, update });
    return {};
  });

  const r = res();
  await deleteComment(
    { params: { id: recipeId.toString(), commentId: commentId.toString() }, user: { _id: userId } },
    r
  );
  return { order, updates, r };
};

describe("deleting a comment", () => {
  it("removes the comment rows before their likes", async () => {
    const { order, r } = await run();
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(order.indexOf("comments")).toBeLessThan(order.indexOf("commentLikes"));
  });

  it("still clears the likes and notifications", async () => {
    const { order } = await run();
    expect(order).toContain("commentLikes");
    expect(order).toContain("notifications");
  });

  it("subtracts what was actually removed", async () => {
    const reply = { _id: new mongoose.Types.ObjectId() };
    const { updates } = await run({ replies: [reply], deletedCount: 2 });
    expect(updates[0].update.$inc).toEqual({ commentCount: -2 });
  });

  it("subtracts nothing when the race already removed it", async () => {
    // The losing side of two concurrent deletes: it found the comment, but
    // deleteMany removed nothing because the winner got there first.
    const { updates } = await run({ deletedCount: 0 });
    const counted = updates.filter((u) => u.update.$inc?.commentCount);
    expect(counted).toEqual([]);
  });

  it("will not take the count below zero", async () => {
    const { updates } = await run({ deletedCount: 2, replies: [{ _id: new mongoose.Types.ObjectId() }] });
    expect(updates[0].filter.commentCount).toEqual({ $gte: 2 });
  });

  it("clears the pin in the same write rather than a second round trip", async () => {
    const { updates, order } = await run({ pinned: commentId });
    expect(updates[0].update.$set).toEqual({ pinnedComment: null });
    expect(order.filter((step) => step === "count")).toHaveLength(1);
  });

  it("leaves a pin alone when it points at a different comment", async () => {
    const { updates } = await run({ pinned: new mongoose.Types.ObjectId() });
    expect(updates[0].update.$set).toBeUndefined();
  });
});
