import express from "express";
import { getCategories, suggestCategories } from "../controllers/categoryController.js";
import { suggestLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.get("/", suggestLimiter, getCategories);
router.get("/suggest", suggestLimiter, suggestCategories);

export default router;
