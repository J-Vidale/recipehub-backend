import { describe, it, expect } from "vitest";
import { parseOrigins, createOriginCheck, toOrigin } from "../config/origins.js";

// The real check, built over a known list rather than the module-level one,
// which is fixed at import time from the environment.
const allows = (origins, origin) => {
  let allowed;
  createOriginCheck(origins)(origin, (err, result) => {
    expect(err).toBeNull();
    allowed = result;
  });
  return allowed;
};

describe("toOrigin", () => {
  it("keeps a plain origin as it is", () => {
    expect(toOrigin("https://recipehub.com")).toBe("https://recipehub.com");
  });

  // The three ways a correct value arrives in the wrong shape.
  it.each([
    ["a trailing slash", "https://recipehub.com/"],
    ["a path copied from the address bar", "https://recipehub.com/explore?tag=soup"],
    ["a capitalised host", "https://RecipeHub.COM"],
    ["surrounding whitespace", "  https://recipehub.com  "],
    ["an explicit default port", "https://recipehub.com:443"],
  ])("reduces %s to the origin a browser sends", (_label, value) => {
    expect(toOrigin(value)).toBe("https://recipehub.com");
  });

  it("keeps a non-default port, which is part of the origin", () => {
    expect(toOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it.each(["", "   ", "not a url", "ftp://x.com", "recipehub.com", undefined, null, 5])(
    "rejects %o",
    (value) => {
      expect(toOrigin(value)).toBeNull();
    }
  );
});

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

  it("tolerates whitespace, trailing slashes and pasted paths", () => {
    expect(parseOrigins("  https://a.com/ , https://b.com/explore  ")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("drops entries that are not usable origins", () => {
    expect(parseOrigins("https://good.com,not a url,,ftp://x.com")).toEqual([
      "https://good.com",
    ]);
  });

  // A domain and the same domain with a trailing slash are one origin, and
  // listing both is a normal thing to do by accident.
  it("collapses duplicates", () => {
    expect(parseOrigins("https://a.com,https://a.com/,https://A.com")).toEqual([
      "https://a.com",
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

  it("matches even when the variable was set with a path on the end", () => {
    expect(allows(parseOrigins("https://recipehub.com/explore"), "https://recipehub.com")).toBe(
      true
    );
  });

  it("refuses anything else", () => {
    expect(allows(origins, "https://evil.com")).toBe(false);
    expect(allows(origins, "http://recipehub.com")).toBe(false); // scheme matters
    expect(allows(origins, "https://recipehub.com.evil.com")).toBe(false);
    expect(allows(origins, "https://recipehub.com:8443")).toBe(false); // port matters
  });

  // Credentials in front of the host are the classic way to make a URL read
  // as one domain and resolve to another.
  it("is not fooled by a host smuggled behind userinfo", () => {
    expect(allows(origins, "https://recipehub.com@evil.com")).toBe(false);
  });

  // A sandboxed iframe or a file:// page sends the literal string "null".
  it("refuses an opaque origin", () => {
    expect(allows(origins, "null")).toBe(false);
  });

  // Health checks and server-to-server calls send no Origin, and CORS only
  // governs browsers, which always send one.
  it("allows a request with no Origin header", () => {
    expect(allows(origins, undefined)).toBe(true);
    expect(allows(origins, "")).toBe(true);
  });
});
