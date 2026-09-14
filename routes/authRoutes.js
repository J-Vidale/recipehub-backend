import express from "express";
import { registerUser, loginUser, changePassword } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);

// Signed in already, and still asked for the current password: a token is
// something that can be taken, and this is the control that takes an
// account back.
router.patch("/password", protect, changePassword);

export default router;
