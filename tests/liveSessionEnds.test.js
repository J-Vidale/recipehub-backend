import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import mongoose from "mongoose";

// Rejecting a stale token at the handshake only stops the next connection.
// A socket opened before the password changed stays connected and keeps
// delivering, because the handshake is the only place its token is ever
// read. The change tells the person every other device has been signed
// out, so the live one has to go too.

const disconnectUser = vi.fn();
vi.mock("../config/socket.js", () => ({
  disconnectUser: (...args) => disconnectUser(...args),
  emitToUser: vi.fn(),
  initSocket: vi.fn(),
  authorizeSocket: vi.fn(),
}));

const { default: bcrypt } = await import("bcryptjs");
const { default: User } = await import("../models/User.js");
const { changePassword } = await import("../controllers/authController.js");

const userId = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

beforeEach(() => {
  disconnectUser.mockReset();
  process.env.JWT_SECRET = "test-secret-long-enough-for-the-startup-check";
});
afterEach(() => vi.restoreAllMocks());

describe("changing your password", () => {
  const withAccount = (matches) => {
    const save = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(User, "findById").mockReturnValue({
      select: async () => ({ _id: userId, password: "hashed", save }),
    });
    vi.spyOn(bcrypt, "compare").mockResolvedValue(matches);
    return save;
  };

  it("closes the live connection as well", async () => {
    withAccount(true);
    const r = res();

    await changePassword(
      { user: { _id: userId }, body: { currentPassword: "old-password-1", newPassword: "Str0ng-new-password" } },
      r
    );

    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.message).toMatch(/signed out/i);
    expect(disconnectUser, "the socket outlived the password change").toHaveBeenCalledWith(
      String(userId)
    );
  });

  it("does not close anything when the current password was wrong", async () => {
    const save = withAccount(false);
    const r = res();

    await changePassword(
      { user: { _id: userId }, body: { currentPassword: "wrong", newPassword: "Str0ng-new-password" } },
      r
    );

    expect(r.statusCode).toBe(403);
    expect(save).not.toHaveBeenCalled();
    expect(disconnectUser).not.toHaveBeenCalled();
  });
});
