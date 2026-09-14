process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-change-password";

import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { changePassword } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";

// There was no way to change a password at all - so someone who thought
// theirs was compromised could do nothing about it, and someone who forgot
// it lost the account.
//
// The part that makes changing it worth having is that it ends the
// sessions that already exist. Tokens here are stateless and last a week,
// so without that, changing a password leaves whoever prompted the change
// still signed in.

const userId = new mongoose.Types.ObjectId();
const CURRENT = "current-password";

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

afterEach(() => vi.restoreAllMocks());

const account = (over = {}) => ({
  _id: userId,
  password: bcrypt.hashSync(CURRENT, 10),
  save: vi.fn().mockResolvedValue(true),
  ...over,
});

const change = async (body, user) => {
  const found = user ?? account();
  vi.spyOn(User, "findById").mockReturnValue({ select: async () => found });
  const r = res();
  await changePassword({ body, user: { _id: userId } }, r);
  return { r, found };
};

describe("changing your password", () => {
  it("saves the new one", async () => {
    const { r, found } = await change({ currentPassword: CURRENT, newPassword: "a-better-password" });
    expect(r.statusCode).toBe(200);
    expect(found.password).toBe("a-better-password");
    expect(found.save).toHaveBeenCalled();
  });

  it("hands back a fresh token, so you are not logged out by your own change", async () => {
    const { r } = await change({ currentPassword: CURRENT, newPassword: "a-better-password" });
    expect(r.body.token).toBeTruthy();
    expect(jwt.verify(r.body.token, process.env.JWT_SECRET).id).toBe(String(userId));
  });

  it("says that other devices have been signed out", async () => {
    const { r } = await change({ currentPassword: CURRENT, newPassword: "a-better-password" });
    expect(r.body.message).toMatch(/signed out/i);
  });

  it("refuses a wrong current password and saves nothing", async () => {
    const { r, found } = await change({ currentPassword: "not-it", newPassword: "a-better-password" });
    expect(r.statusCode).toBe(403);
    expect(found.save).not.toHaveBeenCalled();
  });

  it("does not answer 401, which would log the caller out", async () => {
    // The client clears the session on a 401. The session here is fine -
    // it is the confirmation that failed.
    const { r } = await change({ currentPassword: "not-it", newPassword: "a-better-password" });
    expect(r.statusCode).not.toBe(401);
  });

  it.each([
    ["no current password", { newPassword: "a-better-password" }],
    ["an empty current password", { currentPassword: "", newPassword: "a-better-password" }],
    ["a non-string current password", { currentPassword: { $ne: null }, newPassword: "a-better-password" }],
    ["no new password", { currentPassword: CURRENT }],
    ["a new password that is too short", { currentPassword: CURRENT, newPassword: "abc" }],
    ["a non-string new password", { currentPassword: CURRENT, newPassword: { $ne: null } }],
    ["no body at all", undefined],
  ])("refuses %s", async (_label, body) => {
    const { r, found } = await change(body);
    expect(r.statusCode).toBe(400);
    expect(found.save).not.toHaveBeenCalled();
  });

  it("refuses the password it already is", async () => {
    const { r, found } = await change({ currentPassword: CURRENT, newPassword: CURRENT });
    expect(r.statusCode).toBe(400);
    expect(found.save).not.toHaveBeenCalled();
  });

  it("reads the password field, which the schema hides by default", async () => {
    const select = vi.fn().mockResolvedValue(account());
    vi.spyOn(User, "findById").mockReturnValue({ select });
    await changePassword(
      { body: { currentPassword: CURRENT, newPassword: "a-better-password" }, user: { _id: userId } },
      res()
    );
    expect(select).toHaveBeenCalledWith("+password");
  });
});

describe("the sessions that already existed", () => {
  const callProtect = async (token, storedUser) => {
    vi.spyOn(User, "findById").mockReturnValue({
      select: () => ({ lean: async () => storedUser }),
    });
    const r = res();
    const next = vi.fn();
    await protect({ headers: { authorization: `Bearer ${token}` } }, r, next);
    return { r, next };
  };

  const tokenIssuedAt = (secondsAgo) =>
    jwt.sign(
      { id: String(userId), iat: Math.floor(Date.now() / 1000) - secondsAgo },
      process.env.JWT_SECRET
    );

  it("stop working once the password changes", async () => {
    // The whole point: whoever was using the old password is logged out.
    const { r, next } = await callProtect(tokenIssuedAt(3600), {
      _id: userId,
      passwordChangedAt: new Date(),
    });
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(401);
    expect(r.body.message).toMatch(/log in again/i);
  });

  it("but a token minted after the change still works", async () => {
    const { next } = await callProtect(tokenIssuedAt(0), {
      _id: userId,
      passwordChangedAt: new Date(Date.now() - 60_000),
    });
    expect(next).toHaveBeenCalled();
  });

  it("and an account that never changed its password is unaffected", async () => {
    const { next } = await callProtect(tokenIssuedAt(3600), { _id: userId });
    expect(next).toHaveBeenCalled();
  });

  it("survives the same-second case the stamp is offset for", async () => {
    // iat is whole seconds, so the token minted moments after a save can
    // carry the same second. passwordChangedAt is stored a second early so
    // that token is not caught by its own change.
    const now = Date.now();
    const { next } = await callProtect(
      jwt.sign({ id: String(userId), iat: Math.floor(now / 1000) }, process.env.JWT_SECRET),
      { _id: userId, passwordChangedAt: new Date(now - 1000) }
    );
    expect(next).toHaveBeenCalled();
  });
});
