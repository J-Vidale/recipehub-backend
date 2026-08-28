import express from "express";
import {
  createRecipe,
  getAllRecipes,
  getMyRecipes,
  getFollowingFeed,
  getSingleRecipe,
  updateRecipe,
  deleteRecipe,
  getRecipesByUser,
  getRecipesByTag,
  getSavedRecipes,
  saveRecipe,
  unsaveRecipe,
} from "../controllers/recipeController.js";
import { addRecipeMedia, deleteRecipeMedia, loadOwnedRecipe } from "../controllers/mediaController.js";
import { uploadSingleMedia } from "../middleware/uploadMiddleware.js";
import { likeRecipe, unlikeRecipe } from "../controllers/likeController.js";
import { shareRecipe, unshareRecipe } from "../controllers/shareController.js";
import {
  addComment,
  getComments,
  deleteComment,
  pinComment,
  unpinComment,
} from "../controllers/commentController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/saved", protect, getSavedRecipes);
router.get("/user/:userId", getRecipesByUser);
router.get("/tag/:tag", getRecipesByTag);

router
  .route("/")
  .get(getAllRecipes)
  .post(protect, createRecipe);

router.route("/mine").get(protect, getMyRecipes);
router.get("/feed", protect, getFollowingFeed);

router
  .route("/:id")
  .get(getSingleRecipe)
  .put(protect, updateRecipe)
  .delete(protect, deleteRecipe);

router.post("/:id/media", protect, loadOwnedRecipe, uploadSingleMedia, addRecipeMedia);
router.delete("/:id/media/:mediaId", protect, loadOwnedRecipe, deleteRecipeMedia);

router.post("/:id/like", protect, likeRecipe);
router.delete("/:id/like", protect, unlikeRecipe);

router.post("/:id/share", protect, shareRecipe);
router.delete("/:id/share", protect, unshareRecipe);

router.post("/:id/comments", protect, addComment);
router.get("/:id/comments", getComments);
router.delete("/:id/comments/:commentId", protect, deleteComment);

router.post("/:id/comments/:commentId/pin", protect, pinComment);
router.delete("/:id/pin", protect, unpinComment);

router.post("/save/:recipeId", protect, saveRecipe);
router.delete("/unsave/:recipeId", protect, unsaveRecipe);

export default router;
