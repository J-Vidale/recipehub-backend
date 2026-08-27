import express from "express";
import {
  createRecipe,
  getAllRecipes,
  getMyRecipes,
  getSingleRecipe,
  updateRecipe,
  deleteRecipe,
  getRecipesByUser,
  getSavedRecipes,
  saveRecipe,
  unsaveRecipe,
} from "../controllers/recipeController.js";
import { likeRecipe, unlikeRecipe } from "../controllers/likeController.js";
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

router
  .route("/")
  .get(getAllRecipes)
  .post(protect, createRecipe);

router.route("/mine").get(protect, getMyRecipes);

router
  .route("/:id")
  .get(protect, getSingleRecipe)
  .put(protect, updateRecipe)
  .delete(protect, deleteRecipe);

router.post("/:id/like", protect, likeRecipe);
router.delete("/:id/like", protect, unlikeRecipe);

router.post("/:id/comments", protect, addComment);
router.get("/:id/comments", getComments);
router.delete("/:id/comments/:commentId", protect, deleteComment);

router.post("/:id/comments/:commentId/pin", protect, pinComment);
router.delete("/:id/pin", protect, unpinComment);

router.post("/save/:recipeId", protect, saveRecipe);
router.delete("/unsave/:recipeId", protect, unsaveRecipe);

export default router;
