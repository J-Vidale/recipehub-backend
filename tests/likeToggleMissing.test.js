import { describe, it, expect, vi } from "vitest";
import { addLike, removeLike } from "../utils/likeToggle.js";

// deleteRecipe clears a recipe's likes before it deletes the recipe, so a
// like arriving between those two writes survives the cascade as an orphan.
// The next like on that recipe is then a duplicate - the row is still there
// - and takes the branch below, which reads a recipe that no longer exists.
//
// removeLike guards that read. addLike did not, so it threw a TypeError,
// which Express 5 forwards as a 500.

const duplicateKey = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

const modelReturning = (doc) => ({
  findById: () => ({ select: async () => doc }),
  findByIdAndUpdate: async () => doc,
  findOneAndUpdate: async () => doc,
});

describe("liking a recipe that has just been deleted", () => {
  it("does not crash when the count row is gone", async () => {
    const LikeModel = { create: vi.fn().mockRejectedValue(duplicateKey()) };
    const result = await addLike({
      LikeModel,
      likeQuery: { user: "u1", recipe: "r1" },
      CountModel: modelReturning(null),
      countId: "r1",
    });
    expect(result).toEqual({ likeCount: 0, likedByMe: true, created: false });
  });

  it("still reports the real count when the recipe is there", async () => {
    const LikeModel = { create: vi.fn().mockRejectedValue(duplicateKey()) };
    const result = await addLike({
      LikeModel,
      likeQuery: { user: "u1", recipe: "r1" },
      CountModel: modelReturning({ likeCount: 7 }),
      countId: "r1",
    });
    expect(result).toEqual({ likeCount: 7, likedByMe: true, created: false });
  });

  it("does not report a like as newly created when it already existed", () => {
    // created:false is what stops a duplicate tap sending a second
    // notification to the recipe's author.
    expect.assertions(1);
    const LikeModel = { create: vi.fn().mockRejectedValue(duplicateKey()) };
    return addLike({ LikeModel, likeQuery: {}, CountModel: modelReturning({ likeCount: 1 }), countId: "r1" })
      .then((r) => expect(r.created).toBe(false));
  });

  it("lets a real failure through rather than swallowing it as a duplicate", async () => {
    const LikeModel = { create: vi.fn().mockRejectedValue(new Error("connection lost")) };
    await expect(
      addLike({ LikeModel, likeQuery: {}, CountModel: modelReturning({ likeCount: 1 }), countId: "r1" })
    ).rejects.toThrow("connection lost");
  });

  it("unliking already guarded the same read", async () => {
    const LikeModel = { findOneAndDelete: async () => null };
    const result = await removeLike({
      LikeModel,
      likeQuery: {},
      CountModel: modelReturning(null),
      countId: "r1",
    });
    expect(result).toEqual({ likeCount: 0, likedByMe: false });
  });
});
