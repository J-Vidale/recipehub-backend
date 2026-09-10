import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Share from "../models/Share.js";
import { shareRecipe, unshareRecipe } from "../controllers/shareController.js";

// Both handlers read the share count back after writing it, and both can
// find the recipe gone: it is deletable, and nothing holds it still between
// the lookup at the top of the handler and the read at the bottom.
// unshareRecipe guarded that read. shareRecipe did not, so it threw a
// TypeError, which Express 5 forwards as a 500.

const userId = new mongoose.Types.ObjectId();
const recipeId = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

afterEach(() => vi.restoreAllMocks());

// Found at the top of the handler, gone by the time the count is read.
const deletedUnderneath = () => {
  let call = 0;
  vi.spyOn(Recipe, "findById").mockImplementation(() => {
    call += 1;
    return call === 1
      ? { lean: async () => ({ _id: recipeId, user: userId }) }
      : { select: () => ({ lean: async () => null }) };
  });
  vi.spyOn(Recipe, "updateOne").mockResolvedValue({});
};

describe("sharing a recipe that is deleted mid-request", () => {
  it("does not crash", async () => {
    deletedUnderneath();
    vi.spyOn(Share, "create").mockResolvedValue({});
    const r = res();
    await shareRecipe({ params: { id: recipeId.toString() }, user: { _id: userId } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ shareCount: 0, sharedByMe: true });
  });

  it("does not crash on the duplicate-share path either", async () => {
    deletedUnderneath();
    vi.spyOn(Share, "create").mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const r = res();
    await shareRecipe({ params: { id: recipeId.toString() }, user: { _id: userId } }, r);
    expect(r.body).toEqual({ shareCount: 0, sharedByMe: true });
  });

  it("unsharing already guarded the same read", async () => {
    deletedUnderneath();
    vi.spyOn(Share, "findOneAndDelete").mockReturnValue({ lean: async () => null });
    const r = res();
    await unshareRecipe({ params: { id: recipeId.toString() }, user: { _id: userId } }, r);
    expect(r.body).toEqual({ shareCount: 0, sharedByMe: false });
  });

  it("still reports the real count when the recipe is there", async () => {
    vi.spyOn(Recipe, "findById").mockImplementation(() => ({
      lean: async () => ({ _id: recipeId, user: userId }),
      select: () => ({ lean: async () => ({ shareCount: 4 }) }),
    }));
    vi.spyOn(Recipe, "updateOne").mockResolvedValue({});
    vi.spyOn(Share, "create").mockResolvedValue({});
    const r = res();
    await shareRecipe({ params: { id: recipeId.toString() }, user: { _id: userId } }, r);
    expect(r.body.shareCount).toBe(4);
  });
});
