import { describe, it, expect } from "vitest";
import { parseOrigins } from "../config/origins.js";

const allows = (origins, origin) => {
  // Rebuilds the check against a given list rather than the module-level
  // one, which is fixed at import time from the environment.
  const normalise = (v) => v.trim().replace(/\/+$/, "");
  return !origin || origins.includes(normalise(origin));
};

describe("parseOrigins", () => {
  it("falls back to the defaults when unset", () => {
    expect(parseOrigins(undefined)).toContain("http://localhost:5173");
    expect(parseOrigins("")).toContain("https://recipehub-frontend-cgip.onrender.com");
    expect(parseOrigins("   ")).toContain("http://localhost:5173");
  });

  it("reads a comma-separated list", () => {
    expect(parseOrigins("https://a.com,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  // The two things everyone gets wrong pasting a URL into a dashboard.
  it("tolerates whitespace and trailing slashes", () => {
    expect(parseOrigins("  https://a.com/ , https://b.com//  ")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("drops entries that are not usable origins", () => {
    expect(parseOrigins("https://good.com,not a url,,ftp://x.com")).toEqual([
      "https://good.com",
    ]);
  });

  // An empty allowlist makes cors() reflect whatever Origin it is sent,
  // which is the opposite of what someone setting this variable wants.
  it("never returns an empty list", () => {
    expect(parseOrigins("nonsense,,,also nonsense").length).toBeGreaterThan(0);
    expect(parseOrigins("ftp://x.com")).toContain("http://localhost:5173");
  });

  it("accepts http and https, and a port", () => {
    expect(parseOrigins("http://localhost:3000,https://x.dev")).toEqual([
      "http://localhost:3000",
      "https://x.dev",
    ]);
  });
});

describe("the origin check", () => {
  const origins = parseOrigins("https://recipehub.com,https://www.recipehub.com");

  it("allows a configured origin", () => {
    expect(allows(origins, "https://recipehub.com")).toBe(true);
    expect(allows(origins, "https://www.recipehub.com")).toBe(true);
  });

  it("allows a configured origin sent with a trailing slash", () => {
    expect(allows(origins, "https://recipehub.com/")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(allows(origins, "https://evil.com")).toBe(false);
    expect(allows(origins, "http://recipehub.com")).toBe(false); // scheme matters
    expect(allows(origins, "https://recipehub.com.evil.com")).toBe(false);
  });

  // Health checks and server-to-server calls send no Origin, and CORS only
  // governs browsers, which always send one.
  it("allows a request with no Origin header", () => {
    expect(allows(origins, undefined)).toBe(true);
    expect(allows(origins, "")).toBe(true);
  });
});
