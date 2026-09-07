import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { buildHealthReport, describeConnectionState } from "../utils/health.js";

describe("describeConnectionState", () => {
  it.each([
    [0, "disconnected"],
    [1, "connected"],
    [2, "connecting"],
    [3, "disconnecting"],
  ])("maps readyState %i to %s", (state, expected) => {
    expect(describeConnectionState(state)).toBe(expected);
  });

  it.each([99, -1, undefined, null, "1"])("does not throw on %o", (state) => {
    expect(describeConnectionState(state)).toBe("unknown");
  });
});

describe("buildHealthReport", () => {
  it("names the service and reports it as up", () => {
    const report = buildHealthReport(1, 42);
    expect(report.status).toBe("ok");
    expect(report.service).toBe("recipehub-api");
  });

  it("includes the database state", () => {
    expect(buildHealthReport(1, 0).database).toBe("connected");
    expect(buildHealthReport(0, 0).database).toBe("disconnected");
  });

  it("rounds uptime to whole seconds", () => {
    expect(buildHealthReport(1, 1834.71).uptimeSeconds).toBe(1835);
  });
});

describe("the endpoint using it", () => {
  const appWith = (readyState) => {
    const app = express();
    app.get("/", (req, res) => res.json(buildHealthReport(readyState, process.uptime())));
    return app;
  };

  it("answers 200 with the database connected", async () => {
    const res = await request(appWith(1)).get("/");
    expect(res.status).toBe(200);
    expect(res.body.database).toBe("connected");
  });

  // The status code answers "is the web process alive". A 503 while the
  // database was briefly unreachable would make the host restart a process
  // that is working fine and cannot fix a database, turning a blip into a
  // restart loop. The database state goes in the body instead.
  it("still answers 200 with the database down", async () => {
    const res = await request(appWith(0)).get("/");
    expect(res.status).toBe(200);
    expect(res.body.database).toBe("disconnected");
  });
});

describe("server.js has not drifted from this", () => {
  it("delegates to buildHealthReport and never sets a status", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
    expect(source).toMatch(
      /buildHealthReport\(mongoose\.connection\.readyState, process\.uptime\(\)\)/
    );
    const route = source.slice(source.indexOf('app.get("/"'), source.indexOf("// Error handling"));
    expect(route).not.toMatch(/res\.status\(/);
    // No query, no await: an uptime pinger hits this every few minutes.
    expect(route).not.toMatch(/await |\.find\(|\.countDocuments\(/);
  });
});
