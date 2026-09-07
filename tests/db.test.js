import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

const URI = "mongodb+srv://recipehub:sup3r-s3cret@cluster0.example.mongodb.net/recipehub";

describe("connectDB", () => {
  let exit;
  let log;
  let error;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.MONGO_URI = URI;
    // A test that let this through would kill the test runner.
    exit = vi.spyOn(process, "exit").mockImplementation(() => {});
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.MONGO_URI;
  });

  it("logs the host it reached on success", async () => {
    vi.spyOn(mongoose, "connect").mockResolvedValue({
      connection: { host: "cluster0-shard-00-01.example.mongodb.net" },
    });

    await connectDB();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("cluster0-shard-00-01.example.mongodb.net")
    );
    expect(error).not.toHaveBeenCalled();
  });

  // The whole point of the change: a database problem must not take the web
  // process down with it, because the health endpoint is what tells you the
  // database is the problem.
  it("does not exit the process when the connection fails", async () => {
    vi.spyOn(mongoose, "connect").mockRejectedValue(new Error("bad auth : authentication failed"));

    await connectDB();

    expect(exit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("authentication failed"));
  });

  it("retries, backing off, until it connects", async () => {
    const connect = vi
      .spyOn(mongoose, "connect")
      .mockRejectedValueOnce(new Error("server selection timed out"))
      .mockRejectedValueOnce(new Error("server selection timed out"))
      .mockResolvedValue({ connection: { host: "cluster0.example.mongodb.net" } });

    await connectDB();
    expect(connect).toHaveBeenCalledTimes(1);

    // Nothing happens before the delay it announced.
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(2);

    // Second wait is longer than the first, so a cluster that is down for a
    // while is not hammered.
    await vi.advanceTimersByTimeAsync(1999);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("cluster0.example.mongodb.net"));
  });

  it("caps the backoff so it keeps trying after a long outage", async () => {
    vi.spyOn(mongoose, "connect").mockRejectedValue(new Error("down"));

    await connectDB();
    // Ten minutes of failures: with uncapped doubling the next attempt
    // would be days away.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    const before = mongoose.connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 1000);
    expect(mongoose.connect.mock.calls.length).toBeGreaterThan(before);
  });

  it("never puts the connection string in a log line", async () => {
    vi.spyOn(mongoose, "connect").mockRejectedValue(new Error("connection refused"));

    await connectDB();

    const written = [...log.mock.calls, ...error.mock.calls].flat().join(" ");
    expect(written).not.toContain("sup3r-s3cret");
    expect(written).not.toContain(URI);
  });

  it("does not attempt a connection with no MONGO_URI, and says so", async () => {
    delete process.env.MONGO_URI;
    const connect = vi.spyOn(mongoose, "connect");

    await connectDB();

    expect(connect).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("MONGO_URI"));
    // And it does not sit in a retry loop towards a variable that cannot
    // appear by itself.
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(connect).not.toHaveBeenCalled();
  });
});
