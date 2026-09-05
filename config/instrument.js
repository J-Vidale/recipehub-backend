// Imported first by server.js, before any other module.
//
// ES module imports are hoisted and evaluated before the importing file's
// own statements, so calling Sentry.init() partway down server.js would
// run after express, mongoose and the route modules had already been
// evaluated - too late for the SDK to wrap them. A side-effect module in
// the first import position is the only ordering that actually works here.
import dotenv from "dotenv";
dotenv.config();

import { initMonitoring } from "./monitoring.js";
initMonitoring();
