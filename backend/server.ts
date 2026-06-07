import "dotenv/config";

import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "http";
import OpenAI from "openai";
import { Server } from "socket.io";
import { FRONTEND_ORIGIN, MAX_TURNS, MODEL, PORT, SKIP_MESSAGE } from "./constants.js";
import {
  executeToolCall,
  getHistory,
  getMessagesHistoryByClient,
  saveMessage,
  sessionMessagesByClient,
  trimHistory,
} from "./helper.js";
import { log } from "./logger.js";
import { schemaList } from "./schemaList.js";
import type { AssistantMsgPayload, HealthResponse, UserMsgPayload } from "./types.js";

const app: Express = express();
const httpServer: HttpServer = createServer(app);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

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

      getMessagesHistoryByClient(socket.id, generateSystemPrompt());
      saveMessage(socket.id, { role: "user", content: message });

      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const history = trimHistory(getHistory(socket.id));
        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages: history,
          tools: schemaList,
          tool_choice: "auto",
        });
        const assistantMessage = completion.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error("OpenAI response did not include an assistant message");
        }

        if (!assistantMessage.tool_calls?.length) {
          const response: AssistantMsgPayload = {
            message: assistantMessage.content || SKIP_MESSAGE,
          };

          saveMessage(socket.id, {
            role: "assistant",
            content: response.message,
          });
          socket.emit("assistant_msg", response);
          return;
        }

        saveMessage(socket.id, {
          role: "assistant",
          content: null,
          tool_calls: assistantMessage.tool_calls,
        });

        for (const call of assistantMessage.tool_calls) {
          try {
            const result = await executeToolCall({ socket, call });
            saveMessage(socket.id, {
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            saveMessage(socket.id, {
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({
                ok: false,
                cmd: call.function.name,
                error: errorMessage,
              }),
            });
          }
        }
      }

      const response: AssistantMsgPayload = {
        kind: "error",
        message: "Request required too many tool steps. Please try a simpler scheduling command.",
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
    sessionMessagesByClient.delete(socket.id);
    log.info(`Client disconnected: ${socket.id}`);
  });
});

function generateSystemPrompt(): string {
  return `
You are MaintenanceSchedulerAssistant.

You help an office building facilities coordinator manage a DHTMLX Scheduler Timeline.
The Scheduler contains scheduled maintenance work orders only. Incoming Requests are unscheduled maintenance requests in a separate frontend-owned panel.

Supported actions:
- inspect current scheduler state
- generate a schedule from incoming maintenance requests
- add, update, or delete scheduled maintenance work orders
- clear scheduled maintenance work orders
- adjust Scheduler view, skin, or zoom

Rules:
- If a request depends on current work orders, incoming requests, resource rows, or maintenance staff availability, call get_scheduler_state first.
- If a supported tool matches the request, call the tool instead of describing the action.
- If the request is unsupported, answer exactly:
${SKIP_MESSAGE}
- Keep final answers short, plain, and facilities-team friendly.
- Do not invent resource ids. Use resource ids from get_scheduler_state when availability matters.
- Scheduled work order dates must use YYYY-MM-DD HH:mm.
- When the user asks to generate a schedule from pending requests, first call get_scheduler_state, then call generate_schedule with work orders created from unscheduledItems only.
- For pending-request scheduling, do not regenerate, summarize, or include existing scheduledItems in generate_schedule arguments.
- Existing scheduled work orders must remain unchanged unless the user explicitly asks to replace the entire schedule. Only then set replaceExisting: true.
- For generate_schedule, keep new work orders inside 09:00-18:00. Lunch 12:00-13:00 pauses work; do not count it toward estimated_minutes.
- Work orders may start before lunch and continue after lunch. For example, a 90-minute request starting at 11:30 should end at 14:00 because lunch does not count as working time.
- Avoid end_date values inside lunch unless the work order actually finishes before lunch begins.
- When converting incoming requests into work orders, preserve each incoming request id as the scheduled appointment id so the frontend can remove used requests from Incoming Requests.
- Prefer matching work_type to the maintenance staff or team specialization shown in get_scheduler_state. Office maintenance work types include HVAC, electrical, plumbing, access control, cleaning, inspection, and repair.

Today is ${new Date().toISOString().slice(0, 10)}.
`;
}

httpServer.listen(PORT, () => {
  log.success(`Scheduler Maker AI Demo API running on :${PORT}`);
});
