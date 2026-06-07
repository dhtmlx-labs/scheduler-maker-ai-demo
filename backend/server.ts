import "dotenv/config";

import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "http";
import { Server } from "socket.io";
import { FRONTEND_ORIGIN, PORT } from "./constants.js";
import { log } from "./logger.js";
import type { AssistantMsgPayload, HealthResponse, UserMsgPayload } from "./types.js";

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

  let pending = false;

  socket.on("user_msg", async (payload: UserMsgPayload) => {
    if (pending) {
      const response: AssistantMsgPayload = {
        kind: "busy",
        message: "I am still processing your previous message. Please wait a moment.",
      };

      socket.emit("assistant_msg", response);
      return;
    }

    pending = true;

    try {
      if (!payload || typeof payload !== "object" || typeof payload.message !== "string") {
        const response: AssistantMsgPayload = {
          kind: "error",
          message: "Please send a valid message object.",
        };

        socket.emit("assistant_msg", response);
        return;
      }

      const message = payload.message.trim();

      if (!message) {
        const response: AssistantMsgPayload = {
          kind: "error",
          message: "Please enter a message before sending.",
        };

        socket.emit("assistant_msg", response);
        return;
      }

      const response: AssistantMsgPayload = {
        kind: "echo",
        message: `Echo from Scheduler assistant: ${message}`,
      };

      socket.emit("assistant_msg", response);
    } catch (error) {
      log.error("Error handling user_msg", error);

      const response: AssistantMsgPayload = {
        kind: "error",
        message: "Something went wrong while handling your message.",
      };

      socket.emit("assistant_msg", response);
    } finally {
      pending = false;
    }
  });

  socket.on("disconnect", () => {
    log.info(`Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  log.success(`Scheduler Maker AI Demo API running on :${PORT}`);
});
