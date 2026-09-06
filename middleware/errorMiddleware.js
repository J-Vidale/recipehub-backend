// middleware/errorMiddleware.js
export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  // Sentry's default filter reads error.status and treats a status-less
  // error as a 500, so without this every mistyped path and every bot
  // scanning for /wp-login.php would be reported as an application
  // exception. Our own handler reads res.statusCode, so this changes
  // nothing about the response.
  error.status = 404;
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isProduction = process.env.NODE_ENV === "production";

  // Only the stack used to be withheld in production - the message went
  // out either way. Express 5 forwards rejected promises here, so that
  // message was whatever the driver or an upstream SDK produced: failing
  // query shapes, collection names, connection details. Deliberate 4xx
  // messages (including notFound's) are written for the client and stay;
  // an unexpected 5xx gets a generic one.
  res.status(statusCode).json({
    message: isProduction && statusCode >= 500 ? "Server error" : err.message,
    stack: isProduction ? null : err.stack,
  });
};