process.env.JWT_SECRET = "probe-secret-0123456789";
const express = (await import("express")).default;
const request = (await import("supertest")).default;
const { loginUser, registerUser } = await import("./controllers/authController.js");
const { errorHandler } = await import("./middleware/errorMiddleware.js");
const User = (await import("./models/User.js")).default;

let queried = null;
User.findOne = (filter) => { queried = filter; const q = { collation: () => q, select: () => q, then: (r) => r(null), lean: () => q }; return q; };

const app = express();
app.use(express.json());
app.post("/login", loginUser);
app.post("/register", registerUser);
app.use(errorHandler);

for (const body of [
  { username: { $ne: null }, password: "x" },
  { username: { $gt: "" }, password: "x" },
  { username: ["a", "b"], password: "x" },
  { username: "ok_user", password: { $ne: null } },
]) {
  queried = null;
  const res = await Promise.race([
    request(app).post("/login").send(body),
    new Promise((ok) => setTimeout(() => ok({ status: 0, body: { message: "hung" } }), 3000)),
  ]);
  console.log(`${String(res.status).padEnd(4)} ${JSON.stringify(body)} -> ${JSON.stringify(res.body).slice(0,80)}`);
  console.log(`      filter reaching mongo: ${JSON.stringify(queried)}`);
}
process.exit(0);
