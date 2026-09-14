// utils/viewerState.js
//
// Which rows on a page the person reading it has already acted on.
//
// The like and share buttons are told nothing about this, so every page
// load showed every heart empty and every recipe unshared, however many of
// them you had liked. Clicking again did no damage - the unique index
// turns a repeat into a no-op and the response corrects the count - but
// the page was simply reporting the wrong thing.
//
// One query per page rather than one per row: a feed of fifty recipes
// costs a single lookup against the (user, recipe) index.

import Like from "../models/Like.js";
import Share from "../models/Share.js";
import CommentLike from "../models/CommentLike.js";
import User from "../models/User.js";

const actedOn = async (Model, field, viewerId, targetIds) => {
  // No viewer (a logged-out reader) and no rows both mean the same thing
  // here, and neither is worth a round trip.
  if (!viewerId || !targetIds.length) return new Set();
  const ids = await Model.find({ user: viewerId, [field]: { $in: targetIds } }).distinct(field);
  // Strings, because callers compare against an ObjectId's own string form.
  return new Set(ids.map(String));
};

export const likedRecipeIds = (viewerId, recipeIds) =>
  actedOn(Like, "recipe", viewerId, recipeIds);

export const sharedRecipeIds = (viewerId, recipeIds) =>
  actedOn(Share, "recipe", viewerId, recipeIds);

export const likedCommentIds = (viewerId, commentIds) =>
  actedOn(CommentLike, "comment", viewerId, commentIds);

// Saved recipes are an array on the user rather than a collection of their
// own, so this one is a single exists() against that array instead of a
// lookup over rows.
//
// The recipe page used to answer this by fetching the whole saved list -
// every saved recipe, fully populated - and searching it for one id. That
// is an unbounded download to decide whether one button says "Save" or
// "Unsave".
export const hasSavedRecipe = async (viewerId, recipeId) => {
  if (!viewerId) return false;
  return Boolean(await User.exists({ _id: viewerId, savedRecipes: recipeId }));
};
