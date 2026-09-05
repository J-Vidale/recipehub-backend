import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { notFound, errorHandler } from "../middleware/errorMiddleware.js";

const original = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = original;
});

const app = () => {
  const a = express();
  a.get("/boom", () => {
    throw new Error("MongoServerError: E11000 duplicate key on recipehub.users index username_1");
  });
  a.get("/refused", (req, res) => {
    res.status(403);
    throw new Error("You cannot message this user");
  });
  a.get("/async-boom", async () => {
    // Express 5 forwards a rejected promise to the error handler, which is
    // how driver messages reached clients before this was gated.
    throw new Error("connection <monitor> to 10.0.0.4:27017 closed");
  });
  a.use(notFound);
  a.use(errorHandler);
  return a;
};

describe("in production", () => {
  it("replaces an unexpected 500 message with a generic one", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app()).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Server error");
  });

  it("discloses no collection or index names", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app()).get("/boom");
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/E11000|recipehub|username_1/);
  });

  it("does the same for an async failure", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app()).get("/async-boom");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Server error");
    expect(JSON.stringify(res.body)).not.toMatch(/27017/);
  });

  it("sends no stack", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app()).get("/boom");
    expect(res.body.stack).toBeNull();
  });

  it("still delivers deliberate 4xx messages, which are written for the client", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app()).get("/refused");
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You cannot message this user");
  });

  it("still returns a useful 404", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app()).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Not Found/);
  });
});

describe("outside production", () => {
  it("keeps the real message and a stack, for debugging", async () => {
    process.env.NODE_ENV = "development";
    const res = await request(app()).get("/boom");
    expect(res.body.message).toMatch(/E11000/);
    expect(typeof res.body.stack).toBe("string");
  });
});
