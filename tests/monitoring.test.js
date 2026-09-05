import { describe, it, expect, afterEach, vi } from "vitest";

const original = process.env.SENTRY_DSN;
afterEach(() => {
  if (original === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = original;
  vi.resetModules();
});

// Monitoring has to be entirely optional. Nobody running this locally, and
// no CI job, should need a Sentry account for the server to start.
describe("without a DSN", () => {
  it("reports itself as disabled", async () => {
    delete process.env.SENTRY_DSN;
    const { isMonitoringEnabled } = await import("../config/monitoring.js");
    expect(isMonitoringEnabled()).toBe(false);
  });

  it("initMonitoring is a no-op that returns false", async () => {
    delete process.env.SENTRY_DSN;
    const { initMonitoring } = await import("../config/monitoring.js");
    expect(initMonitoring()).toBe(false);
  });

  it("captureError does nothing rather than throwing", async () => {
    delete process.env.SENTRY_DSN;
    const { captureError } = await import("../config/monitoring.js");
    expect(() => captureError(new Error("boom"), { route: "/x" })).not.toThrow();
  });

  it("the instrument module imports cleanly", async () => {
    delete process.env.SENTRY_DSN;
    await expect(import("../config/instrument.js")).resolves.toBeDefined();
  });
});

describe("with a DSN", () => {
  it("initialises and reports itself as enabled", async () => {
    process.env.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
    const { initMonitoring, isMonitoringEnabled } = await import("../config/monitoring.js");
    expect(initMonitoring()).toBe(true);
    expect(isMonitoringEnabled()).toBe(true);
  });
});

// The API carries private messages, email addresses and bearer tokens.
// None of it should reach a third-party dashboard.
describe("the payload scrubber", () => {
  const options = async () => {
    process.env.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
    const { buildSentryOptions } = await import("../config/monitoring.js");
    return buildSentryOptions();
  };

  it("does not opt into personally identifying data", async () => {
    expect((await options()).sendDefaultPii).toBe(false);
  });

  it("samples traces rather than sending all of them", async () => {
    expect((await options()).tracesSampleRate).toBeLessThan(1);
  });

  it("strips credentials and bodies from an outgoing event", async () => {
    const { beforeSend } = await options();
    const event = beforeSend({
      request: {
        cookies: { session: "secret" },
        data: { password: "hunter2" },
        headers: { authorization: "Bearer abc", cookie: "a=b", "user-agent": "test" },
      },
    });
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.data).toBeUndefined();
    expect(event.request.headers.authorization).toBeUndefined();
    expect(event.request.headers.cookie).toBeUndefined();
    // Non-sensitive headers survive, so the report is still useful.
    expect(event.request.headers["user-agent"]).toBe("test");
  });

  it("passes an event with no request through untouched", async () => {
    const { beforeSend } = await options();
    expect(beforeSend({ message: "plain" }).message).toBe("plain");
  });

  it("copes with a request that has no headers", async () => {
    const { beforeSend } = await options();
    expect(() => beforeSend({ request: {} })).not.toThrow();
  });
});
