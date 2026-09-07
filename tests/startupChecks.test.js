import { describe, it, expect } from "vitest";
import {
  collectStartupWarnings,
  summariseConfig,
  reportStartup,
} from "../utils/startupChecks.js";

const complete = {
  NODE_ENV: "production",
  MONGO_URI: "mongodb+srv://recipehub:realpassword@cluster0.example.mongodb.net/recipehub",
  JWT_SECRET: "x".repeat(48),
  CLOUDINARY_CLOUD_NAME: "recipehub",
  CLOUDINARY_API_KEY: "123456789",
  CLOUDINARY_API_SECRET: "secret",
  CORS_ORIGINS: "https://recipehub.example.com",
};

const warningsFor = (overrides) => collectStartupWarnings({ ...complete, ...overrides });
const joined = (overrides) => warningsFor(overrides).join(" | ");

describe("collectStartupWarnings", () => {
  it("says nothing when everything is configured", () => {
    expect(collectStartupWarnings(complete)).toEqual([]);
  });

  it("names MONGO_URI when it is missing", () => {
    expect(joined({ MONGO_URI: "" })).toMatch(/MONGO_URI is not set/);
  });

  // Atlas hands over the connection string with the password still written
  // as a placeholder, and pasting it unchanged is the classic first deploy.
  it.each(["<db_password>", "<password>"])("catches the %s placeholder", (placeholder) => {
    const uri = `mongodb+srv://recipehub:${placeholder}@cluster0.example.mongodb.net/recipehub`;
    expect(joined({ MONGO_URI: uri })).toMatch(/placeholder/i);
  });

  it("catches a connection string whose password was deleted but not replaced", () => {
    const uri = "mongodb+srv://recipehub:@cluster0.example.mongodb.net/recipehub";
    expect(joined({ MONGO_URI: uri })).toMatch(/empty password/);
  });

  it("does not mistake a real password for a placeholder", () => {
    const uri = "mongodb+srv://recipehub:aB3<x>9@cluster0.example.mongodb.net/recipehub";
    expect(joined({ MONGO_URI: uri })).not.toMatch(/MONGO_URI/);
  });

  it("names JWT_SECRET when it is missing or too short", () => {
    expect(joined({ JWT_SECRET: "" })).toMatch(/JWT_SECRET is not set/);
    expect(joined({ JWT_SECRET: "short" })).toMatch(/shorter than 32/);
  });

  it("lists exactly which Cloudinary keys are missing", () => {
    const warning = joined({ CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "" });
    expect(warning).toMatch(/CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET/);
    expect(warning).not.toMatch(/CLOUDINARY_CLOUD_NAME/);
  });

  it("warns about an unset CORS_ORIGINS in production", () => {
    expect(joined({ CORS_ORIGINS: "" })).toMatch(/CORS_ORIGINS is not set/);
  });

  // Locally the built-in list already covers the Vite dev and preview
  // servers, so this would be noise on every restart.
  it("stays quiet about CORS_ORIGINS outside production", () => {
    expect(joined({ CORS_ORIGINS: "", NODE_ENV: "development" })).not.toMatch(/CORS_ORIGINS/);
  });

  it("treats whitespace as unset", () => {
    expect(joined({ JWT_SECRET: "   " })).toMatch(/JWT_SECRET is not set/);
  });

  it("defaults to process.env", () => {
    expect(() => collectStartupWarnings()).not.toThrow();
  });
});

describe("summariseConfig", () => {
  it("reports the environment, origins and both optional services", () => {
    const lines = summariseConfig(complete, ["https://recipehub.example.com"]).join("\n");
    expect(lines).toMatch(/Environment: production/);
    expect(lines).toMatch(/https:\/\/recipehub\.example\.com/);
    expect(lines).toMatch(/Error monitoring: off \(SENTRY_DSN unset\)/);
    expect(lines).toMatch(/Cache: off \(REDIS_URL unset\)/);
  });

  it("reports them as on once they are configured", () => {
    const lines = summariseConfig(
      { ...complete, SENTRY_DSN: "https://k@o.ingest.sentry.io/1", REDIS_URL: "redis://x" },
      []
    ).join("\n");
    expect(lines).toMatch(/Error monitoring: on/);
    expect(lines).toMatch(/Cache: Redis/);
  });
});

describe("what actually reaches the log", () => {
  const capture = () => {
    const out = { logs: [], warns: [] };
    return {
      out,
      sink: { log: (m) => out.logs.push(m), warn: (m) => out.warns.push(m) },
    };
  };

  it("prints the summary first so the warnings that reference it make sense", () => {
    const { out, sink } = capture();
    reportStartup({ ...complete, CORS_ORIGINS: "" }, ["http://localhost:5173"], sink);
    expect(out.logs[1]).toMatch(/Allowed browser origins: http:\/\/localhost:5173/);
    expect(out.warns.join(" ")).toMatch(/^WARNING: CORS_ORIGINS/);
  });

  // The deploy log is visible to anyone who can open the dashboard.
  it("never prints a secret's value", () => {
    const { out, sink } = capture();
    const env = {
      ...complete,
      MONGO_URI: "mongodb+srv://recipehub:hunter2@cluster0.example.mongodb.net/recipehub",
      JWT_SECRET: "s3cr3t-signing-key-that-is-long-enough",
      CLOUDINARY_API_SECRET: "cloudinary-secret-value",
      SENTRY_DSN: "https://publickey@o1.ingest.sentry.io/42",
      REDIS_URL: "redis://:redispassword@redis.example.com:6379",
    };
    reportStartup(env, [], sink);
    const printed = [...out.logs, ...out.warns].join(" ");
    for (const secret of [
      "hunter2",
      env.MONGO_URI,
      env.JWT_SECRET,
      env.CLOUDINARY_API_SECRET,
      env.SENTRY_DSN,
      env.REDIS_URL,
    ]) {
      expect(printed).not.toContain(secret);
    }
  });
});

describe("server.js has not drifted from this", () => {
  it("reports at startup with the origins it actually allows", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
    expect(source).toMatch(/reportStartup\(process\.env, allowedOrigins\)/);
  });
});
