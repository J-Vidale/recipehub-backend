// utils/likeToggle.js
// Shared idempotent like/unlike logic for anything with a LikeModel
// (Like, CommentLike) and a denormalized likeCount field on CountModel
// (Recipe, Comment). Uses atomic $inc so concurrent requests can't cause
// lost updates, unlike a read-modify-write `doc.likeCount += 1; doc.save()`.

export async function addLike({ LikeModel, likeQuery, CountModel, countId }) {
  try {
    await LikeModel.create(likeQuery);
    const updated = await CountModel.findByIdAndUpdate(
      countId,
      { $inc: { likeCount: 1 } },
      { new: true }
    );
    return { likeCount: updated ? updated.likeCount : 0, likedByMe: true, created: true };
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Already liked - idempotent; re-read the current count.
    const current = await CountModel.findById(countId).select("likeCount");
    return { likeCount: current.likeCount, likedByMe: true, created: false };
  }
}

export async function removeLike({ LikeModel, likeQuery, CountModel, countId }) {
  const deleted = await LikeModel.findOneAndDelete(likeQuery);
  if (deleted) {
    const updated = await CountModel.findOneAndUpdate(
      { _id: countId, likeCount: { $gt: 0 } },
      { $inc: { likeCount: -1 } },
      { new: true }
    );
    return { likeCount: updated ? updated.likeCount : 0, likedByMe: false };
  }
  const current = await CountModel.findById(countId).select("likeCount");
  return { likeCount: current ? current.likeCount : 0, likedByMe: false };
}
