// The shape of the API's health response, kept out of server.js so the
// mapping can be tested directly. mongoose.connection.readyState is a
// non-configurable getter, so a test cannot stub it; a pure function taking
// the number is both easier to verify and easier to read.

const STATES = ["disconnected", "connected", "connecting", "disconnecting"];

// Number.isInteger, not a bare index: STATES["1"] is "connected" in
// JavaScript, so without the guard a string would quietly map to a real
// state and "unknown" would not mean what it says. Mongoose always passes
// a number; this keeps the contract honest anyway.
export const describeConnectionState = (readyState) =>
  (Number.isInteger(readyState) ? STATES[readyState] : undefined) ?? "unknown";

// `readyState` is a local integer the driver keeps current, so building
// this costs no database round trip - which matters because this endpoint
// is the host's health check and the target for any uptime pinger.
export const buildHealthReport = (readyState, uptimeSeconds) => ({
  status: "ok",
  service: "recipehub-api",
  database: describeConnectionState(readyState),
  uptimeSeconds: Math.round(uptimeSeconds),
});
