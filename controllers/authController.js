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
    // Anything else is re-thrown rather than answered here. The error
    // middleware already sends "Server error" in production, so the
    // response is unchanged - but it is also the only thing Sentry is
    // wired to, and a registration failing for everyone should not be
    // something we find out from a user.
    throw err;
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
};

// PATCH /api/auth/password   body: { currentPassword, newPassword }
//
// Changing a password without ending the sessions that already exist does
// not solve the problem people change a password for. Saving a new one
// stamps passwordChangedAt, and protect() refuses any token minted before
// it - so whoever was using the old password is logged out, everywhere.
// The caller gets a fresh token so they are not logged out by their own
// change.
export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (typeof currentPassword !== "string" || !currentPassword) {
    return res.status(400).json({ message: "Your current password is required" });
  }
  const problem = validatePassword(newPassword);
  if (problem) {
    return res.status(400).json({ message: problem });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ message: "That is already your password" });
  }

  const user = await User.findById(req.user._id).select("+password");
  if (!user) {
    return res.status(404).json({ message: "Account not found" });
  }

  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) {
    // 403, not 401: the session is valid, it is the confirmation that
    // failed. A 401 would tell the client to clear the session, which is
    // how mistyping a password logs someone out instead of telling them.
    return res.status(403).json({ message: "That password is not correct" });
  }

  // The model hashes on save and stamps passwordChangedAt there, so both
  // stay true for anything else that ever sets a password.
  user.password = newPassword;
  await user.save();

  res.json({
    message: "Password changed. Any other device signed in as you has been signed out.",
    token: generateToken(user._id),
  });
};
