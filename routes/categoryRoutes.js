import express from "express";
import { getCategories, suggestCategories } from "../controllers/categoryController.js";

const router = express.Router();

router.get("/", getCategories);
router.get("/suggest", suggestCategories);

export default router;
