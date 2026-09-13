import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import * as purge from "../utils/deleteAccount.js";
import { deleteMyAccount } from "../controllers/userController.js";

// The caller is already authenticated, and this still asks for their
// password. A token is something that can be taken - left on a shared
// machine, lifted by a script - and every other thing a stolen token can
// do is reversible by its owner. This one is not.

const userId = new mongoose.Types.ObjectId();
const hashed = bcrypt.hashSync("correct horse battery", 10);

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

const withStoredPassword = () => {
  vi.spyOn(User, "findById").mockReturnValue({
    select: async () => ({ _id: userId, password: hashed }),
  });
};

afterEach(() => vi.restoreAllMocks());

const call = async (body) => {
  const r = res();
  await deleteMyAccount({ body, user: { _id: userId } }, r);
  return r;
};

describe("deleting your own account", () => {
  it("goes ahead when the password is right", async () => {
    withStoredPassword();
    const purged = vi.spyOn(purge, "deleteAccount").mockResolvedValue(true);
    const r = await call({ password: "correct horse battery" });
    expect(r.statusCode).toBe(200);
    expect(r.body.message).toMatch(/deleted/i);
    expect(purged).toHaveBeenCalledWith(userId);
  });

  it("refuses a wrong password and deletes nothing", async () => {
    withStoredPassword();
    const purged = vi.spyOn(purge, "deleteAccount");
    const r = await call({ password: "not it" });
    expect(r.statusCode).toBe(403);
    expect(purged, "the account was deleted anyway").not.toHaveBeenCalled();
  });

  it("does not answer 401, which would log the caller out", async () => {
    // The client treats a 401 as a dead session: it clears the token and
    // sends the caller to the login page. The session here is fine - it
    // is the extra confirmation that failed - so mistyping the password
    // logged you out instead of telling you that you mistyped it.
    withStoredPassword();
    const r = await call({ password: "not it" });
    expect(r.statusCode).not.toBe(401);
  });

  it.each([
    ["no body at all", undefined],
    ["an empty body", {}],
    ["an empty password", { password: "" }],
    ["a non-string password", { password: { $ne: null } }],
    ["a number", { password: 12345 }],
  ])("refuses %s", async (_label, body) => {
    withStoredPassword();
    const purged = vi.spyOn(purge, "deleteAccount");
    const r = await call(body);
    expect(r.statusCode).toBe(400);
    expect(purged).not.toHaveBeenCalled();
  });

  it("does not let an operator object stand in for a password", async () => {
    // bcrypt.compare would throw on a non-string, which Express 5 turns
    // into a 500. The type check answers 400 before it gets there.
    withStoredPassword();
    const r = await call({ password: { $ne: null } });
    expect(r.statusCode).toBe(400);
  });

  it("answers 404 when the account is already gone", async () => {
    vi.spyOn(User, "findById").mockReturnValue({ select: async () => null });
    const purged = vi.spyOn(purge, "deleteAccount");
    const r = await call({ password: "correct horse battery" });
    expect(r.statusCode).toBe(404);
    expect(purged).not.toHaveBeenCalled();
  });

  it("reads the password field, which the schema hides by default", async () => {
    const select = vi.fn().mockResolvedValue({ _id: userId, password: hashed });
    vi.spyOn(User, "findById").mockReturnValue({ select });
    vi.spyOn(purge, "deleteAccount").mockResolvedValue(true);
    await call({ password: "correct horse battery" });
    expect(select).toHaveBeenCalledWith("+password");
  });
});
