import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User, { CASE_INSENSITIVE } from "../models/User.js";
import {
  validateUsername,
  validateEmail,
  validatePassword,
  MAX_PASSWORD_LENGTH,
} from "../utils/credentials.js";

// A hash of a value no submitted password will match, used to spend the
// same time on a username that does not exist as on one that does.
//
// Without it, a login for an unknown username returned in a millisecond
// while a wrong password for a real one took the ~80ms bcrypt costs, and
// that difference is a reliable answer to "is this person registered
// here" for anyone willing to time it. Computed once at startup.
const ABSENT_USER_HASH = bcrypt.hashSync("password-for-no-one", 10);

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

    // One message at a time, in field order, so the form can show the
    // error against the field it belongs to.
    const invalid =
      validateUsername(username) || validateEmail(email) || validatePassword(password);
    if (invalid) {
      return res.status(400).json({ message: invalid });
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

  // Refused before it reaches bcrypt: no real password is this long, and
  // hashing a hundred kilobytes of it on every attempt would be a cheap
  // way to keep the process busy.
  if (password.length > MAX_PASSWORD_LENGTH) {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  try {
    // Same collation as registration, so the name that was accepted is the
    // name that logs in, whatever case it is typed in.
    const user = await User.findOne({ username: username.trim() })
      .collation(CASE_INSENSITIVE)
      .select("+password");
    // The comparison runs either way. Skipping it when there is no such
    // user is what makes the response time say whether the name exists.
    const matches = user
      ? await user.matchPassword(password)
      : await bcrypt.compare(password, ABSENT_USER_HASH);

    if (!user || !matches) {
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
