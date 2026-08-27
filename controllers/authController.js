import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Generate JWT
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// POST /api/auth/register
export const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (
      typeof username !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !username ||
      !email ||
      !password
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: "Username already in use" });
    }

    const newUser = await User.create({
      username,
      email,
      password, // let the pre-save hook hash it
    });

    res.status(201).json({
      _id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      token: generateToken(newUser._id),
    });
  } catch (err) {
    res.status(500).json({
      message:
        process.env.NODE_ENV === "development" ? err.message : "Server error",
    });
  }
};

// POST /api/auth/login
export const loginUser = async (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  try {
    const user = await User.findOne({ username });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    res.json({
      _id: user._id,
      username: user.username,
      email: user.email,
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(500).json({
      message:
        process.env.NODE_ENV === "development" ? err.message : "Server error",
    });
  }
};
