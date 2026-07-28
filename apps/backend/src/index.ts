import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { initDb } from "./db.js";
import { authRouter, callbackRouter } from "./routes/auth.js";
import { apiRouter } from "./routes/contacts.js";
import { revenueRouter } from "./routes/revenue.js";
import { auditRouter } from "./routes/audit.js";
import { dealsRouter } from "./routes/deals.js";
import { revenueIntelRouter } from "./routes/revenueIntel.js";

const app = express();

app.use(cors({ origin: config.FRONTEND_URL }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/oauth-callback", callbackRouter);
app.use("/api", apiRouter);
app.use("/api", revenueRouter);
app.use("/api", auditRouter);
app.use("/api", dealsRouter);
app.use("/api", revenueIntelRouter);

async function start() {
  await initDb();
  app.listen(config.PORT, () => {
    console.log(`[server] listening on http://localhost:${config.PORT}`);
  });
}

start().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
