import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import Report from "../models/Report.js";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import User from "../models/User.js";
import { createReport } from "../controllers/reportController.js";

// A report is a row a human has to read. Nothing checked that the thing
// being reported existed, that it was not the reporter's own, or that the
// reporter had not already filed one - so three separate ways to fill a
// moderator's queue with rows nobody can act on, one of which (clicking
// the button twice) needs no ill intent at all.

const me = new mongoose.Types.ObjectId();
const someoneElse = new mongoose.Types.ObjectId();
const targetId = new mongoose.Types.ObjectId();

const res = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

const req = (overrides = {}) => ({
  user: { _id: me },
  body: { targetType: "recipe", targetId: targetId.toString(), reason: "spam", ...overrides },
});

// findReportTarget does Model.findById(id).select(...).lean().
const lookupReturns = (Model, doc) =>
  vi.spyOn(Model, "findById").mockReturnValue({ select: () => ({ lean: async () => doc }) });

const existingOpenReport = (doc) =>
  vi.spyOn(Report, "findOne").mockReturnValue({ select: () => ({ lean: async () => doc }) });

afterEach(() => vi.restoreAllMocks());

describe("reporting something that is not there", () => {
  it.each([
    ["recipe", Recipe],
    ["comment", Comment],
    ["user", User],
  ])("a %s id that matches nothing is refused", async (targetType, Model) => {
    lookupReturns(Model, null);
    const create = vi.spyOn(Report, "create").mockResolvedValue({ _id: "r" });

    const r = res();
    await createReport(req({ targetType }), r);

    expect(r.statusCode).toBe(404);
    expect(create, "a report was filed about nothing").not.toHaveBeenCalled();
  });
});

describe("reporting your own content", () => {
  it("is refused for a recipe you own", async () => {
    lookupReturns(Recipe, { _id: targetId, user: me });
    const create = vi.spyOn(Report, "create").mockResolvedValue({ _id: "r" });

    const r = res();
    await createReport(req(), r);

    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/your own content/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("is refused for your own account", async () => {
    // A user report's owner is the account itself, so this falls out of
    // the same comparison rather than needing a case of its own.
    lookupReturns(User, { _id: me });
    const create = vi.spyOn(Report, "create").mockResolvedValue({ _id: "r" });

    const r = res();
    await createReport(req({ targetType: "user", targetId: me.toString() }), r);

    expect(r.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("reporting the same thing twice", () => {
  it("does not file a second row while the first is still open", async () => {
    lookupReturns(Recipe, { _id: targetId, user: someoneElse });
    const firstId = new mongoose.Types.ObjectId();
    existingOpenReport({ _id: firstId });
    const create = vi.spyOn(Report, "create").mockResolvedValue({ _id: "r" });

    const r = res();
    await createReport(req(), r);

    expect(create, "the queue got a duplicate row").not.toHaveBeenCalled();
    // Not an error: from where the reporter is standing they did the right
    // thing, and telling them it failed invites a third try.
    expect(r.statusCode).toBe(200);
    expect(r.body.message).toMatch(/already reported/i);
    expect(String(r.body.reportId)).toBe(String(firstId));
  });

  it("only counts an open report as a duplicate", async () => {
    lookupReturns(Recipe, { _id: targetId, user: someoneElse });
    const findOne = existingOpenReport(null);
    vi.spyOn(Report, "create").mockResolvedValue({ _id: "new" });

    const r = res();
    await createReport(req(), r);

    expect(findOne.mock.calls[0][0].status).toBe("open");
    expect(r.statusCode).toBe(201);
  });
});

describe("an ordinary report", () => {
  it("still goes through", async () => {
    lookupReturns(Recipe, { _id: targetId, user: someoneElse });
    existingOpenReport(null);
    const create = vi.spyOn(Report, "create").mockResolvedValue({ _id: "new" });

    const r = res();
    await createReport(req({ reason: "  spam  " }), r);

    expect(r.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ reporter: me, targetType: "recipe", reason: "spam" })
    );
  });

  it("is rejected before any lookup when the reason is missing", async () => {
    const findById = vi.spyOn(Recipe, "findById");

    const r = res();
    await createReport(req({ reason: "   " }), r);

    expect(r.statusCode).toBe(400);
    expect(findById, "a bad request still cost a database read").not.toHaveBeenCalled();
  });
});
