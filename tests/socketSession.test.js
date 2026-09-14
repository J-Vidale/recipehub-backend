import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import { authorizeSocket } from "../config/socket.js";

// Changing a password ends every session. It ended every HTTP session:
// protect() re-reads the account on each request and rejects a token
// minted before the change. The live connection was not covered. The
// handshake is the only place a socket's token is ever looked at, and it
// asked one question - does this account exist - so a stolen token still
// opened a socket and kept delivering that person's messages and
// notifications in real time.

const userId = new mongoose.Types.ObjectId();
const SECRET = "test-secret-for-socket-handshake";

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
});
afterEach(() => vi.restoreAllMocks());

// An hour ago, in whole seconds, the way a real iat is stored.
const tokenIssuedAt = (date) =>
  jwt.sign({ id: userId.toString(), iat: Math.floor(date.getTime() / 1000) }, SECRET);

const account = (passwordChangedAt) =>
  vi.spyOn(User, "findById").mockReturnValue({
    select: () => ({ lean: async () => ({ _id: userId, passwordChangedAt }) }),
  });

describe("the handshake", () => {
  it("turns away a token minted before the password changed", async () => {
    const anHourAgo = new Date(Date.now() - 3600_000);
    account(new Date());

    await expect(authorizeSocket(tokenIssuedAt(anHourAgo))).rejects.toThrow(/session ended/i);
  });

  it("lets the token issued by the change itself through", async () => {
    // passwordChangedAt is stamped a second in the past precisely so the
    // replacement token is not caught by its own rule.
    const changedAt = new Date(Date.now() - 1000);
    account(changedAt);

    await expect(authorizeSocket(tokenIssuedAt(new Date()))).resolves.toBe(userId.toString());
  });

  it("lets an ordinary token through when no password has ever changed", async () => {
    account(undefined);
    await expect(authorizeSocket(tokenIssuedAt(new Date()))).resolves.toBe(userId.toString());
  });

  it("refuses a handshake with no token at all", async () => {
    const lookup = vi.spyOn(User, "findById");
    await expect(authorizeSocket(undefined)).rejects.toThrow(/no token/i);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a token signed with something else", async () => {
    account(undefined);
    const forged = jwt.sign({ id: userId.toString() }, "not-the-secret");
    await expect(authorizeSocket(forged)).rejects.toThrow(/invalid token/i);
  });

  it("refuses a token for an account that is gone", async () => {
    vi.spyOn(User, "findById").mockReturnValue({ select: () => ({ lean: async () => null }) });
    await expect(authorizeSocket(tokenIssuedAt(new Date()))).rejects.toThrow(/not found/i);
  });

  it("reads passwordChangedAt, or it cannot apply the rule at all", async () => {
    const lookup = account(undefined);
    await authorizeSocket(tokenIssuedAt(new Date()));
    expect(lookup.mock.results[0].value.select).toBeTypeOf("function");
    // The projection is the thing that would silently break this: select
    // it away and every token looks fresh.
    const select = vi.fn(() => ({ lean: async () => ({ _id: userId }) }));
    vi.spyOn(User, "findById").mockReturnValue({ select });
    await authorizeSocket(tokenIssuedAt(new Date()));
    expect(select.mock.calls[0][0]).toMatch(/passwordChangedAt/);
  });
});
