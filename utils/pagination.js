import mongoose from "mongoose";

// Cursor pagination for the list endpoints that sort by { _id: -1 }.
//
// .skip(n) makes MongoDB walk and discard n documents before returning
// anything, so page 50 costs fifty times page 1 and the reader waits
// longer the further in they scroll. Because these lists are already
// ordered by _id descending, "everything after the last one you saw" is
// expressible as a filter - _id < cursor - which the same index answers
// in constant time whatever page you are on.
//
// Both styles are accepted on purpose. A client that still sends ?page=
// keeps working exactly as before, and every response now also carries
// nextCursor, so the frontend can move over without a flag day. Once no
// caller sends page any more, the skip branch can go.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const parseListQuery = (query, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) => {
  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit;
  limit = Math.min(limit, maxLimit);

  let page = parseInt(query.page, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;

  // An unparseable cursor is ignored rather than rejected: it means a
  // stale or hand-edited link, and starting from the top is a better
  // outcome there than an error page.
  const cursor =
    typeof query.cursor === "string" && mongoose.Types.ObjectId.isValid(query.cursor)
      ? query.cursor
      : null;

  return {
    limit,
    page,
    cursor,
    // Skipping is only meaningful without a cursor. Doing both would skip
    // within the already-narrowed range and silently drop documents.
    skip: cursor ? 0 : (page - 1) * limit,
  };
};

// For list endpoints that cannot use a cursor - anything not ordered by
// _id, such as the discover ranking or conversations ordered by last
// message. Accepting a cursor there and ignoring it would zero the skip
// and quietly serve page 1 while reporting page 4, so the cursor is not
// parsed at all and page is always honoured.
export const parsePageQuery = (query, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) => {
  const { limit, page } = parseListQuery(query, defaultLimit, maxLimit);
  return { limit, page, skip: (page - 1) * limit };
};

// Adds the cursor clause to a filter without mutating the caller's object.
export const withCursor = (filter, cursor) =>
  cursor ? { ...filter, _id: { $lt: cursor } } : filter;

// One document more than the page size is fetched so hasMore is known
// without a second count query; this trims it back off and reports both
// the flag and the cursor to continue from.
export const buildPage = (documents, limit, extra = {}) => {
  const hasMore = documents.length > limit;
  const items = hasMore ? documents.slice(0, limit) : documents;
  return {
    items,
    hasMore,
    nextCursor: hasMore && items.length ? String(items[items.length - 1]._id) : null,
    ...extra,
  };
};
