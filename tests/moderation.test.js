import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import mongoose from "mongoose";
import Report from "../models/Report.js";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import User from "../models/User.js";
import { isAdmin, adminUsernames, requireAdmin } from "../middleware/adminMiddleware.js";
import { listReports, updateReportStatus } from "../controllers/reportController.js";

// Reports were written and never read: no endpoint, no role, no page,
// while the reporter was told "Report submitted. Thanks for letting us
// know." On a site with public comments and private messaging that is a
// promise with nothing behind it.
//
// Who moderates comes from the environment, not from a flag on the user.
// A stored flag is one bad write away from being set by someone who should
// not have it, and there is no safe way to grant the first one through an
// API that has no admin yet.

const reportId = new mongoose.Types.ObjectId();
const recipeId = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

afterEach(() => vi.restoreAllMocks());

describe("who counts as a moderator", () => {
  it("nobody, when the list is unset", () => {
    // An empty list locks the door rather than leaving it open.
    expect(adminUsernames({})).toEqual([]);
    expect(isAdmin({ username: "marta" }, {})).toBe(false);
  });

  it("nobody, when the list is empty or just separators", () => {
    expect(isAdmin({ username: "marta" }, { ADMIN_USERNAMES: "" })).toBe(false);
    expect(isAdmin({ username: "marta" }, { ADMIN_USERNAMES: " , ,, " })).toBe(false);
  });

  it("the names on the list", () => {
    const env = { ADMIN_USERNAMES: "marta,kenji" };
    expect(isAdmin({ username: "marta" }, env)).toBe(true);
    expect(isAdmin({ username: "kenji" }, env)).toBe(true);
    expect(isAdmin({ username: "someone_else" }, env)).toBe(false);
  });

  it("ignores spacing around the names", () => {
    expect(isAdmin({ username: "kenji" }, { ADMIN_USERNAMES: " marta , kenji " })).toBe(true);
  });

  it("ignores case, because usernames are unique case-insensitively", () => {
    // The username index uses a strength-2 collation, so Marta and marta
    // cannot both exist. An admin list that cared about case would be a
    // trap nobody would think to look for.
    expect(isAdmin({ username: "Marta" }, { ADMIN_USERNAMES: "marta" })).toBe(true);
    expect(isAdmin({ username: "marta" }, { ADMIN_USERNAMES: "MARTA" })).toBe(true);
  });

  it("nobody, for a caller with no username at all", () => {
    const env = { ADMIN_USERNAMES: "marta" };
    expect(isAdmin(undefined, env)).toBe(false);
    expect(isAdmin({}, env)).toBe(false);
    expect(isAdmin({ username: "" }, env)).toBe(false);
    expect(isAdmin({ username: null }, env)).toBe(false);
  });
});

describe("the moderation gate", () => {
  it("hides the route from everyone else", () => {
    // 404, not 403: a 403 confirms the route exists and that somebody is
    // allowed to use it, which is a free hint to anyone probing.
    const r = res();
    const next = vi.fn();
    requireAdmin({ user: { username: "not_an_admin" } }, r, next);
    expect(r.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("lets a moderator through", () => {
    process.env.ADMIN_USERNAMES = "marta";
    const next = vi.fn();
    requireAdmin({ user: { username: "marta" } }, res(), next);
    expect(next).toHaveBeenCalled();
    delete process.env.ADMIN_USERNAMES;
  });
});

describe("reading the queue", () => {
  const reportRow = (targetType, targetId) => ({
    _id: reportId,
    targetType,
    targetId,
    reason: "spam",
    status: "open",
    reporter: { username: "kenji" },
  });

  beforeEach(() => {
    vi.spyOn(Recipe, "find").mockReturnValue({
      select: () => ({ lean: async () => [{ _id: recipeId, title: "Suspicious stew" }] }),
    });
    vi.spyOn(Comment, "find").mockReturnValue({ select: () => ({ lean: async () => [] }) });
    vi.spyOn(User, "find").mockReturnValue({ select: () => ({ lean: async () => [] }) });
  });

  const listWith = async (rows, query = {}) => {
    vi.spyOn(Report, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ populate: () => ({ lean: async () => rows }) }) }),
    });
    const r = res();
    await listReports({ query }, r);
    return r;
  };

  it("says what each report is actually about", async () => {
    // A moderator cannot act on "a report about 64f1c0de..." - the whole
    // job is looking at the thing being complained about.
    const r = await listWith([reportRow("recipe", recipeId)]);
    expect(r.body.reports[0].target).toEqual({ _id: recipeId, title: "Suspicious stew" });
  });

  it("keeps the reason separate from the reported thing", async () => {
    const r = await listWith([reportRow("recipe", recipeId)]);
    expect(r.body.reports[0].reason).toBe("spam");
    expect(r.body.reports[0].target.title).toBe("Suspicious stew");
  });

  it("shows a report whose target is already gone rather than failing", async () => {
    const missing = new mongoose.Types.ObjectId();
    const r = await listWith([reportRow("recipe", missing)]);
    expect(r.body.reports[0].target).toBeNull();
  });

  it("resolves targets in one query per kind, not one per report", async () => {
    const rows = Array.from({ length: 10 }, () => reportRow("recipe", recipeId));
    await listWith(rows);
    expect(Recipe.find).toHaveBeenCalledTimes(1);
  });

  it("refuses a status it does not recognise", async () => {
    const r = res();
    await listReports({ query: { status: "banished" } }, r);
    expect(r.statusCode).toBe(400);
  });

  it("accepts the statuses the model allows", async () => {
    for (const status of ["open", "reviewed"]) {
      const r = await listWith([], { status });
      expect(r.statusCode, status).toBe(200);
    }
  });

  it("reports whether there is another page", async () => {
    const r = await listWith([reportRow("recipe", recipeId)]);
    expect(r.body).toHaveProperty("hasMore");
    expect(r.body).toHaveProperty("nextCursor");
  });
});

describe("marking one handled", () => {
  const updated = { _id: reportId, status: "reviewed", reporter: { username: "kenji" } };

  it("moves the status", async () => {
    const find = vi.spyOn(Report, "findByIdAndUpdate").mockReturnValue({
      populate: () => ({ lean: async () => updated }),
    });
    const r = res();
    await updateReportStatus({ params: { id: reportId.toString() }, body: { status: "reviewed" } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.status).toBe("reviewed");
    expect(find.mock.calls[0][1]).toEqual({ $set: { status: "reviewed" } });
  });

  it.each([
    ["a status outside the enum", { status: "banished" }],
    ["no status", {}],
    ["no body", undefined],
    ["an operator object", { status: { $ne: null } }],
  ])("refuses %s", async (_label, body) => {
    const find = vi.spyOn(Report, "findByIdAndUpdate");
    const r = res();
    await updateReportStatus({ params: { id: reportId.toString() }, body }, r);
    expect(r.statusCode).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  it("answers 400 for an id that is not an id", async () => {
    // What routeIdValidation asserts for every other route. That sweep
    // skips this one because the admin gate answers 404 to its non-admin
    // caller first, so the 400 a moderator gets is checked here instead.
    const find = vi.spyOn(Report, "findByIdAndUpdate");
    const r = res();
    await updateReportStatus({ params: { id: "not-an-id" }, body: { status: "reviewed" } }, r);
    expect(r.statusCode).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  it("answers 404 for a report that does not exist", async () => {
    vi.spyOn(Report, "findByIdAndUpdate").mockReturnValue({ populate: () => ({ lean: async () => null }) });
    const r = res();
    await updateReportStatus({ params: { id: reportId.toString() }, body: { status: "reviewed" } }, r);
    expect(r.statusCode).toBe(404);
  });
});
