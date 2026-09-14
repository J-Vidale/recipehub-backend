import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import Like from "../models/Like.js";
import Share from "../models/Share.js";
import Follow from "../models/Follow.js";
import Block from "../models/Block.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import Report from "../models/Report.js";
import User from "../models/User.js";
import cloudinary from "../config/cloudinary.js";
// An open socket is the one thing the cascade cannot delete rows for: the
// handshake is the only place its token is ever read, so a connection made
// before the account was deleted would stay open on nothing.
const disconnectUser = vi.fn();
vi.mock("../config/socket.js", () => ({
  disconnectUser: (...args) => disconnectUser(...args),
  emitToUser: vi.fn(),
  initSocket: vi.fn(),
  authorizeSocket: vi.fn(),
}));

const { deleteAccount } = await import("../utils/deleteAccount.js");

// Deleting an account is the one operation with no undo, so the thing
// worth testing is that it reaches everything. A collection missed here
// does not fail loudly - it leaves rows pointing at a user who is gone,
// which surfaces later as a blank name or a count that never comes right.

const userId = new mongoose.Types.ObjectId();
const otherUser = new mongoose.Types.ObjectId();
const ownRecipe = new mongoose.Types.ObjectId();
const theirRecipe = new mongoose.Types.ObjectId();
const savedRecipe = new mongoose.Types.ObjectId();
const theirComment = new mongoose.Types.ObjectId();
const myComment = new mongoose.Types.ObjectId();
const conversationId = new mongoose.Types.ObjectId();

let calls;

const record = (label) => (...args) => {
  calls.push({ label, args });
  return Promise.resolve({ deletedCount: 1 });
};

const findReturning = (rows) => ({
  select: () => ({ lean: async () => rows }),
  lean: async () => rows,
  distinct: async () => rows,
});

beforeEach(() => {
  calls = [];
  disconnectUser.mockReset();

  vi.spyOn(User, "findById").mockReturnValue({
    select: () => ({ lean: async () => ({ _id: userId, avatarPublicId: "avatars/me", savedRecipes: [savedRecipe] }) }),
  });
  vi.spyOn(User, "deleteOne").mockImplementation(record("user.delete"));
  vi.spyOn(User, "updateMany").mockImplementation(record("user.updateMany"));
  vi.spyOn(User, "bulkWrite").mockImplementation(record("user.bulkWrite"));

  vi.spyOn(Recipe, "find").mockReturnValue(
    findReturning([{ _id: ownRecipe, media: [{ publicId: "recipes/a", type: "image" }] }])
  );
  vi.spyOn(Recipe, "deleteMany").mockImplementation(record("recipe.deleteMany"));
  vi.spyOn(Recipe, "updateMany").mockImplementation(record("recipe.updateMany"));
  vi.spyOn(Recipe, "bulkWrite").mockImplementation(record("recipe.bulkWrite"));

  vi.spyOn(Comment, "find").mockImplementation((filter) => {
    if (filter?.user) return findReturning([{ _id: myComment, recipe: theirRecipe }]);
    if (filter?.parentComment) return findReturning([]);
    return findReturning([theirComment]);
  });
  vi.spyOn(Comment, "deleteMany").mockImplementation(record("comment.deleteMany"));
  vi.spyOn(Comment, "bulkWrite").mockImplementation(record("comment.bulkWrite"));

  vi.spyOn(CommentLike, "find").mockReturnValue(findReturning([{ comment: theirComment }]));
  vi.spyOn(CommentLike, "deleteMany").mockImplementation(record("commentLike.deleteMany"));
  vi.spyOn(Like, "find").mockReturnValue(findReturning([{ recipe: theirRecipe }]));
  vi.spyOn(Like, "deleteMany").mockImplementation(record("like.deleteMany"));
  vi.spyOn(Share, "find").mockReturnValue(findReturning([{ recipe: theirRecipe }]));
  vi.spyOn(Share, "deleteMany").mockImplementation(record("share.deleteMany"));

  vi.spyOn(Follow, "find").mockImplementation((filter) =>
    findReturning(filter?.follower ? [{ following: otherUser }] : [{ follower: otherUser }])
  );
  vi.spyOn(Follow, "deleteMany").mockImplementation(record("follow.deleteMany"));
  vi.spyOn(Block, "deleteMany").mockImplementation(record("block.deleteMany"));

  vi.spyOn(Conversation, "find").mockReturnValue(findReturning([conversationId]));
  vi.spyOn(Conversation, "deleteMany").mockImplementation(record("conversation.deleteMany"));
  vi.spyOn(Message, "deleteMany").mockImplementation(record("message.deleteMany"));
  vi.spyOn(Notification, "deleteMany").mockImplementation(record("notification.deleteMany"));
  vi.spyOn(Report, "deleteMany").mockImplementation(record("report.deleteMany"));

  vi.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
});

afterEach(() => vi.restoreAllMocks());

const labels = () => calls.map((c) => c.label);

describe("deleting an account", () => {
  it("reaches every collection that references a user", async () => {
    await deleteAccount(userId);
    for (const label of [
      "user.delete",
      "recipe.deleteMany",
      "comment.deleteMany",
      "commentLike.deleteMany",
      "like.deleteMany",
      "share.deleteMany",
      "follow.deleteMany",
      "block.deleteMany",
      "conversation.deleteMany",
      "message.deleteMany",
      "notification.deleteMany",
      "report.deleteMany",
    ]) {
      expect(labels(), `nothing removed from ${label}`).toContain(label);
    }
  });

  it("removes the account row before anything else", async () => {
    // protect() looks the user up on every request, so once the row is
    // gone their token buys nothing and no new content can arrive behind
    // the cascade.
    await deleteAccount(userId);
    expect(labels()[0]).toBe("user.delete");
  });

  it("reports that there was nothing to delete", async () => {
    User.findById.mockReturnValue({ select: () => ({ lean: async () => null }) });
    await expect(deleteAccount(userId)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("says it deleted an account that existed", async () => {
    await expect(deleteAccount(userId)).resolves.toBe(true);
  });
});

describe("the counters it leaves behind", () => {
  it("puts back likes it gave to other people's recipes", async () => {
    await deleteAccount(userId);
    const ops = calls.filter((c) => c.label === "recipe.bulkWrite").flatMap((c) => c.args[0]);
    const likeOp = ops.find((op) => op.updateOne.update.$inc.likeCount === -1);
    expect(likeOp, "likeCount was left too high").toBeTruthy();
    expect(likeOp.updateOne.filter._id).toEqual(theirRecipe);
  });

  it("puts back comment likes it gave", async () => {
    await deleteAccount(userId);
    const ops = calls.filter((c) => c.label === "comment.bulkWrite").flatMap((c) => c.args[0]);
    expect(ops.some((op) => op.updateOne.update.$inc.likeCount === -1)).toBe(true);
  });

  it("puts back shares and saves", async () => {
    await deleteAccount(userId);
    const ops = calls.filter((c) => c.label === "recipe.bulkWrite").flatMap((c) => c.args[0]);
    expect(ops.some((op) => op.updateOne.update.$inc.shareCount === -1)).toBe(true);
    const saveOp = ops.find((op) => op.updateOne.update.$inc.saveCount === -1);
    expect(saveOp, "saveCount on a saved recipe was left too high").toBeTruthy();
    expect(saveOp.updateOne.filter._id).toEqual(savedRecipe);
  });

  it("puts back the comment count on other people's recipes", async () => {
    await deleteAccount(userId);
    const ops = calls.filter((c) => c.label === "recipe.bulkWrite").flatMap((c) => c.args[0]);
    const commentOp = ops.find((op) => op.updateOne.update.$inc.commentCount === -1);
    expect(commentOp).toBeTruthy();
    expect(commentOp.updateOne.filter._id).toBe(theirRecipe.toString());
  });

  it("puts back follower and following counts on both sides", async () => {
    await deleteAccount(userId);
    const ops = calls.filter((c) => c.label === "user.bulkWrite").flatMap((c) => c.args[0]);
    expect(ops.some((op) => op.updateOne.update.$inc.followerCount === -1)).toBe(true);
    expect(ops.some((op) => op.updateOne.update.$inc.followingCount === -1)).toBe(true);
  });

  it("never takes a counter below zero", async () => {
    await deleteAccount(userId);
    const ops = [...calls.filter((c) => c.label.endsWith("bulkWrite"))].flatMap((c) => c.args[0]);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      const [field] = Object.keys(op.updateOne.update.$inc);
      expect(op.updateOne.filter[field], `${field} has no floor`).toBeDefined();
    }
  });
});

describe("the images", () => {
  it("removes the avatar and every recipe photo", async () => {
    await deleteAccount(userId);
    const destroyed = cloudinary.uploader.destroy.mock.calls.map(([id]) => id);
    expect(destroyed).toContain("avatars/me");
    expect(destroyed).toContain("recipes/a");
  });

  it("finishes even when Cloudinary is unreachable", async () => {
    // The database is already the truth by then. An asset left behind
    // costs storage, not correctness.
    cloudinary.uploader.destroy.mockImplementation(() => {
      throw new Error("Must supply api_key");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deleteAccount(userId)).resolves.toBe(true);
  });
});

describe("the live connection", () => {
  it("is closed, not left open on an account that no longer exists", async () => {
    await deleteAccount(userId);

    expect(
      disconnectUser,
      "the socket stayed connected after the account was deleted"
    ).toHaveBeenCalledWith(String(userId));
  });

  it("is closed once the account row is gone, not before", async () => {
    // Same reasoning as the row order itself: while the account exists,
    // its token still buys something, so there is nothing to gain by
    // cutting the connection first.
    await deleteAccount(userId);

    const deletedAt = calls.findIndex((call) => call.label === "user.delete");
    expect(deletedAt).toBeGreaterThanOrEqual(0);
    expect(disconnectUser).toHaveBeenCalledTimes(1);
  });
});
