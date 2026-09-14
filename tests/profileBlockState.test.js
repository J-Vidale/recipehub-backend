import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import User from "../models/User.js";
import Recipe from "../models/Recipe.js";
import Follow from "../models/Follow.js";
import Block from "../models/Block.js";
import { getUserProfile } from "../controllers/userController.js";

// The profile said whether the viewer follows this person but not whether
// they have blocked them, so the block button on the page had nothing to
// initialise from and always rendered as "Block". Unblocking is that same
// button in its other state, which made a block unreachable to undo after
// a reload - the one operation where that matters most.

const me = new mongoose.Types.ObjectId();
const them = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

afterEach(() => vi.restoreAllMocks());

const profileOf = async ({ viewer = { _id: me }, blocked = false, following = false } = {}) => {
  vi.spyOn(User, "findById").mockReturnValue({
    select: () => ({ lean: async () => ({ _id: them, username: "kenji", avatarUrl: null, followerCount: 3, followingCount: 1, createdAt: new Date() }) }),
  });
  vi.spyOn(Recipe, "countDocuments").mockResolvedValue(2);
  vi.spyOn(Follow, "exists").mockResolvedValue(following ? { _id: "f" } : null);
  vi.spyOn(Block, "exists").mockResolvedValue(blocked ? { _id: "b" } : null);
  const r = res();
  await getUserProfile({ params: { id: them.toString() }, user: viewer }, r);
  return r;
};

describe("a profile you are looking at", () => {
  it("says when you have blocked them", async () => {
    const r = await profileOf({ blocked: true });
    expect(r.body.blockedByMe).toBe(true);
  });

  it("says when you have not", async () => {
    const r = await profileOf({ blocked: false });
    expect(r.body.blockedByMe).toBe(false);
  });

  it("answers with a boolean, not a document", async () => {
    // Block.exists returns a document or null, and the button treats the
    // value as a boolean.
    const r = await profileOf({ blocked: true });
    expect(typeof r.body.blockedByMe).toBe("boolean");
  });

  it("still reports following separately", async () => {
    const r = await profileOf({ blocked: true, following: false });
    expect(r.body.followingByMe).toBe(false);
    expect(r.body.blockedByMe).toBe(true);
  });

  it("says false for a signed-out viewer rather than asking the database", async () => {
    const exists = vi.spyOn(Block, "exists");
    const r = await profileOf({ viewer: undefined });
    expect(r.body.blockedByMe).toBe(false);
    expect(exists).not.toHaveBeenCalled();
  });

  it("does not ask whether you blocked yourself", async () => {
    vi.spyOn(User, "findById").mockReturnValue({
      select: () => ({ lean: async () => ({ _id: me, username: "marta", followerCount: 0, followingCount: 0, createdAt: new Date() }) }),
    });
    vi.spyOn(Recipe, "countDocuments").mockResolvedValue(0);
    const exists = vi.spyOn(Block, "exists");
    const r = res();
    await getUserProfile({ params: { id: me.toString() }, user: { _id: me } }, r);
    expect(r.body.blockedByMe).toBe(false);
    expect(exists).not.toHaveBeenCalled();
  });
});
