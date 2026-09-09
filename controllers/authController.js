import jwt from "jsonwebtoken";
import User, { CASE_INSENSITIVE } from "../models/User.js";

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

    // Trimmed here as well as in the schema: the schema trims what gets
    // stored, but these lookups compare what was typed, so " marta" would
    // otherwise miss the existing "marta" and fail later on the index.
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    const existingEmail = await User.findOne({ email: cleanEmail }).lean();
    if (existingEmail) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // Case-insensitively: "Marta" and "marta" are the same name to
    // everyone reading it, so they cannot be two accounts.
    const existingUsername = await User.findOne({ username: cleanUsername })
      .collation(CASE_INSENSITIVE)
      .lean();
    if (existingUsername) {
      return res.status(400).json({ message: "Username already in use" });
    }

    const newUser = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      password, // let the pre-save hook hash it
    });

    res.status(201).json({
      _id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      token: generateToken(newUser._id),
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(400).json({ message: `${field} already in use` });
    }
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
    // Same collation as registration, so the name that was accepted is the
    // name that logs in, whatever case it is typed in.
    const user = await User.findOne({ username: username.trim() })
      .collation(CASE_INSENSITIVE)
      .select("+password");
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
