import "dotenv/config";

import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "http";
import { Server } from "socket.io";
import { FRONTEND_ORIGIN, PORT } from "./constants.js";
import { log } from "./logger.js";
import type { HealthResponse } from "./types.js";

const app: Express = express();
const httpServer: HttpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_ORIGIN,
  },
});

app.use(express.json());
app.use(express.static("../frontend/dist"));

app.get("/health", (_req, res) => {
  const payload: HealthResponse = {
    ok: true,
    app: "scheduler-maker-ai-demo",
  };

  res.json(payload);
});

io.on("connection", (socket) => {
  log.info(`Client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    log.info(`Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  log.success(`Scheduler Maker AI Demo API running on :${PORT}`);
});
