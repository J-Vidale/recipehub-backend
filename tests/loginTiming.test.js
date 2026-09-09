import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import User from "../models/User.js";

process.env.JWT_SECRET = "test-secret-that-is-long-enough-to-be-real";

let loginUser;
beforeAll(async () => {
  ({ loginUser } = await import("../controllers/authController.js"));
});

// A stand-in for the query chain the controller builds. No database is
// involved; what is being tested is what the controller does when the
// lookup comes back empty.
const findOneReturning = (user) =>
  vi.spyOn(User, "findOne").mockReturnValue({
    collation: () => ({ select: async () => user }),
  });

const call = async (body) => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await loginUser({ body }, res);
  return res;
};

afterEach(() => vi.restoreAllMocks());

describe("logging in as a username that does not exist", () => {
  it("is refused", async () => {
    findOneReturning(null);
    const res = await call({ username: "nobody", password: "whatever" });
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Invalid username or password");
  });

  // The reason for the throwaway comparison. Returning immediately when
  // there is no such user made the response time a reliable answer to "is
  // this person registered here", for anyone willing to time it.
  it("costs the same as a wrong password for a real account", async () => {
    findOneReturning(null);
    const started = performance.now();
    await call({ username: "nobody", password: "whatever" });
    const elapsed = performance.now() - started;

    // A bcrypt comparison at cost 10 is tens of milliseconds; an early
    // return is a fraction of one.
    expect(elapsed).toBeGreaterThan(20);
  });

  it("says the same thing as a wrong password does", async () => {
    findOneReturning({ matchPassword: async () => false });
    const wrongPassword = await call({ username: "marta", password: "wrong" });

    findOneReturning(null);
    const noSuchUser = await call({ username: "nobody", password: "wrong" });

    expect(noSuchUser.body).toEqual(wrongPassword.body);
    expect(noSuchUser.statusCode).toBe(wrongPassword.statusCode);
  });
});

describe("an absurdly long password", () => {
  it("is refused before it reaches bcrypt", async () => {
    const findOne = findOneReturning(null);
    const started = performance.now();
    const res = await call({ username: "marta", password: "a".repeat(200_000) });
    const elapsed = performance.now() - started;

    expect(res.statusCode).toBe(401);
    // Neither hashed nor looked up.
    expect(elapsed).toBeLessThan(20);
    expect(findOne).not.toHaveBeenCalled();
  });
});
