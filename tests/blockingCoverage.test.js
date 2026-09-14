import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Like from "../models/Like.js";
import Share from "../models/Share.js";
import Block from "../models/Block.js";
import Comment from "../models/Comment.js";
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
      "commentLikeController.js",
      "followController.js",
      "messageController.js",
    ]) {
      const source = await readFile(new URL(`../controllers/${file}`, import.meta.url), "utf8");
      expect(source, `${file} does not check for a block`).toMatch(/isBlockedEitherWay/);
    }
  });
});

// The two places the check was missing. Both hang off a comment, and a
// comment's author is not the recipe's owner - which is the only person
// the checks above guard. So blocking someone stopped them touching your
// recipes and left your comments, on anybody's recipe, open to them.
describe("interactions that hang off a comment, not a recipe", () => {
  const otherRecipeOwner = new mongoose.Types.ObjectId();
  const commentId = new mongoose.Types.ObjectId();

  // isBlockedEitherWay is called once per party. Answer per party rather
  // than a flat true/false, so a test can say "the recipe's owner has not
  // blocked me, the comment's author has" - the case that was open.
  const blockBetween = (...blockedParties) => {
    const ids = blockedParties.map(String);
    vi.spyOn(Block, "findOne").mockImplementation((query) => ({
      select: () => ({
        lean: async () =>
          ids.includes(String(query.$or[0].blocked)) ? { _id: "b" } : null,
      }),
    }));
  };

  it("liking a comment by someone who blocked you is refused", async () => {
    const { likeComment } = await import("../controllers/commentLikeController.js");
    const CommentLike = (await import("../models/CommentLike.js")).default;
    blockBetween(owner);
    vi.spyOn(Comment, "findById").mockResolvedValue({ _id: commentId, user: owner });
    const create = vi.spyOn(CommentLike, "create").mockResolvedValue({});

    const r = res();
    await likeComment({ params: { commentId: commentId.toString() }, user: { _id: me } }, r);

    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(/cannot like this comment/i);
    expect(create, "the like went through anyway").not.toHaveBeenCalled();
  });

  it("liking a comment still works when nobody is blocked", async () => {
    const { likeComment } = await import("../controllers/commentLikeController.js");
    const CommentLike = (await import("../models/CommentLike.js")).default;
    blockBetween();
    vi.spyOn(Comment, "findById").mockResolvedValue({ _id: commentId, user: owner });
    vi.spyOn(CommentLike, "create").mockResolvedValue({});
    vi.spyOn(Comment, "findByIdAndUpdate").mockResolvedValue({ likeCount: 1 });

    const r = res();
    await likeComment({ params: { commentId: commentId.toString() }, user: { _id: me } }, r);

    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.likeCount).toBe(1);
  });

  it("unliking a comment stays open, so a block cannot strand your like", async () => {
    const { unlikeComment } = await import("../controllers/commentLikeController.js");
    const CommentLike = (await import("../models/CommentLike.js")).default;
    blockBetween(owner);
    vi.spyOn(Comment, "findById").mockResolvedValue({ _id: commentId, user: owner });
    vi.spyOn(CommentLike, "findOneAndDelete").mockResolvedValue({ _id: "row" });
    vi.spyOn(Comment, "findOneAndUpdate").mockResolvedValue({ likeCount: 0 });

    const r = res();
    await unlikeComment({ params: { commentId: commentId.toString() }, user: { _id: me } }, r);

    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.likedByMe).toBe(false);
  });

  it("replying to a comment by someone who blocked you is refused", async () => {
    const { addComment } = await import("../controllers/commentController.js");
    // The recipe belongs to a third party who has blocked nobody: the only
    // block is the one between the replier and the comment's author.
    blockBetween(owner);
    const recipe = { _id: recipeId, user: otherRecipeOwner };
    vi.spyOn(Recipe, "findById").mockReturnValue({ lean: async () => recipe });
    vi.spyOn(Comment, "findById").mockReturnValue({
      lean: async () => ({ _id: commentId, recipe: recipeId, user: owner, parentComment: null }),
    });
    const create = vi.spyOn(Comment, "create").mockResolvedValue({});

    const r = res();
    await addComment(
      {
        params: { id: recipeId.toString() },
        body: { text: "hello", parentComment: commentId.toString() },
        user: { _id: me },
      },
      r
    );

    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(/cannot reply to this comment/i);
    expect(create, "the reply went through anyway").not.toHaveBeenCalled();
  });
});
