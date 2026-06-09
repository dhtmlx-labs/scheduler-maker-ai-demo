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
import type {
  AssistantMsgPayload,
  CancelRequestPayload,
  HealthResponse,
  SchedulerStateEventPayload,
  UserMsgPayload,
} from "./types.js";

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
  let activeRequestId: string | null = null;
  let activeAbortController: AbortController | null = null;
  const canceledRequestIds = new Set<string>();

  function isCanceled(requestId: string): boolean {
    return canceledRequestIds.has(requestId);
  }

  socket.on("cancel_request", (payload: CancelRequestPayload) => {
    if (!isCancelRequestPayload(payload)) {
      log.warn("[cancel-request] ignored invalid payload", {
        socketId: socket.id,
        payload,
      });
      return;
    }

    canceledRequestIds.add(payload.requestId);

    if (activeRequestId === payload.requestId) {
      activeAbortController?.abort();
    }

    log.info("[cancel-request] request marked canceled", {
      socketId: socket.id,
      requestId: payload.requestId,
    });
  });

  socket.on("scheduler_state_event", (payload: SchedulerStateEventPayload) => {
    try {
      if (!isSchedulerStateEventPayload(payload)) {
        log.warn("[scheduler-state-event] ignored invalid payload", {
          socketId: socket.id,
          payload,
        });
        return;
      }

      getMessagesHistoryByClient(socket.id, generateSystemPrompt());
      saveMessage(socket.id, {
        role: "system",
        content: formatSchedulerStateEventNote(payload),
      });
      log.info("[scheduler-state-event] saved session note", {
        socketId: socket.id,
        type: payload.type,
        scheduledIds: payload.scheduledIds,
        unscheduledIds: payload.unscheduledIds,
      });
    } catch (error) {
      log.error("[scheduler-state-event] failed to save session note", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

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
      const requestId = typeof payload.requestId === "string" && payload.requestId.trim()
        ? payload.requestId
        : `${socket.id}:${Date.now()}`;

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
      activeRequestId = requestId;
      activeAbortController = new AbortController();

      const requestToolCounts = new Map<string, number>();

      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        if (isCanceled(requestId)) {
          log.info("[cancel-request] stopped before OpenAI turn", {
            socketId: socket.id,
            requestId,
            turn,
          });
          return;
        }

        const history = trimHistory(getHistory(socket.id));
        const startedAt = Date.now();
        log.info("[diagnostics] openai_turn_start", {
          socketId: socket.id,
          turn,
          historyMessages: history.length,
        });
        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages: history,
          tools: schemaList,
          tool_choice: "auto",
        }, {
          signal: activeAbortController.signal,
        });
        const durationMs = Date.now() - startedAt;
        const assistantMessage = completion.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error("OpenAI response did not include an assistant message");
        }

        log.info("[diagnostics] openai_turn_complete", {
          socketId: socket.id,
          turn,
          durationMs,
          toolCalls: assistantMessage.tool_calls?.map((call) => ({
            toolCallId: call.id,
            toolName: call.function.name,
          })) ?? [],
          hasFinalMessage: !assistantMessage.tool_calls?.length,
        });

        if (!assistantMessage.tool_calls?.length) {
          if (isCanceled(requestId)) {
            log.info("[cancel-request] ignored final assistant response", {
              socketId: socket.id,
              requestId,
            });
            return;
          }

          const response: AssistantMsgPayload = {
            message: assistantMessage.content || SKIP_MESSAGE,
            requestId,
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

        for (const [toolIndex, call] of assistantMessage.tool_calls.entries()) {
          if (isCanceled(requestId)) {
            log.info("[cancel-request] stopped before tool call", {
              socketId: socket.id,
              requestId,
              turn,
              toolIndex,
            });
            return;
          }

          const toolName = call.function.name;
          const toolCount = (requestToolCounts.get(toolName) ?? 0) + 1;
          requestToolCounts.set(toolName, toolCount);

          log.info("[diagnostics] tool_call_start", {
            socketId: socket.id,
            turn,
            toolIndex,
            toolCallId: call.id,
            toolName,
            requestToolCount: toolCount,
            repeatedInRequest: toolCount > 1,
          });

          try {
            const result = await executeToolCall({ socket, call, requestId, turn, toolIndex });

            if (isCanceled(requestId)) {
              log.info("[cancel-request] ignored tool result after cancellation", {
                socketId: socket.id,
                requestId,
                turn,
                toolIndex,
                toolName,
              });
              return;
            }

            log.info("[diagnostics] tool_call_success", {
              socketId: socket.id,
              turn,
              toolIndex,
              toolCallId: call.id,
              toolName,
              result,
            });
            saveMessage(socket.id, {
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            if (isCanceled(requestId)) {
              log.info("[cancel-request] ignored tool failure after cancellation", {
                socketId: socket.id,
                requestId,
                turn,
                toolIndex,
                toolName,
                error: errorMessage,
              });
              return;
            }

            log.error("[diagnostics] tool_call_failure", {
              socketId: socket.id,
              turn,
              toolIndex,
              toolCallId: call.id,
              toolName,
              error: errorMessage,
            });
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
        requestId: activeRequestId ?? undefined,
      };

      socket.emit("assistant_msg", response);
    } catch (error) {
      if (activeRequestId && isCanceled(activeRequestId)) {
        log.info("[cancel-request] request canceled", {
          socketId: socket.id,
          requestId: activeRequestId,
        });
        return;
      }

      log.error("Error handling user_msg", error);

      const response: AssistantMsgPayload = {
        kind: "error",
        message: "Something went wrong while handling your message.",
      };

      socket.emit("assistant_msg", response);
    } finally {
      if (activeRequestId && isCanceled(activeRequestId)) {
        canceledRequestIds.delete(activeRequestId);
      }

      pending = false;
      activeRequestId = null;
      activeAbortController = null;
    }
  });

  socket.on("disconnect", () => {
    sessionMessagesByClient.delete(socket.id);
    log.info(`Client disconnected: ${socket.id}`);
  });
});

function isCancelRequestPayload(payload: unknown): payload is CancelRequestPayload {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    typeof (payload as Partial<CancelRequestPayload>).requestId === "string" &&
    (payload as Partial<CancelRequestPayload>).requestId?.trim(),
  );
}

function isSchedulerStateEventPayload(payload: unknown): payload is SchedulerStateEventPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const maybePayload = payload as Partial<SchedulerStateEventPayload>;

  return (
    (maybePayload.type === "preview_applied" || maybePayload.type === "preview_canceled") &&
    isIdArray(maybePayload.scheduledIds) &&
    isIdArray(maybePayload.unscheduledIds)
  );
}

function isIdArray(value: unknown): value is Array<string | number> {
  return Array.isArray(value) && value.every((id) => (
    typeof id === "string" || typeof id === "number"
  ));
}

function formatIds(ids: Array<string | number>): string {
  return ids.length ? ids.join(", ") : "none";
}

function formatSchedulerStateEventNote(payload: SchedulerStateEventPayload): string {
  const action = payload.type === "preview_applied"
    ? "The user applied the preview. The preview was committed to the live schedule."
    : "The user canceled the preview. The preview was discarded.";

  return [
    "Scheduler state event:",
    action,
    "preview.active is false.",
    `Current live scheduled ids: ${formatIds(payload.scheduledIds ?? [])}.`,
    `Current live unscheduled ids: ${formatIds(payload.unscheduledIds ?? [])}.`,
    "This note supersedes older preview-prepared messages in the conversation history.",
  ].join(" ");
}

function generateSystemPrompt(): string {
  return `
You are MaintenanceSchedulerAssistant.

You help an office building facilities coordinator manage a DHTMLX Scheduler Timeline.
The Scheduler contains scheduled maintenance work orders only. Incoming Requests are unscheduled maintenance requests in a separate frontend-owned panel.

Supported actions:
- inspect current scheduler state
- generate a schedule from incoming maintenance requests
- add, update, or delete scheduled maintenance work orders
- move scheduled maintenance work orders back into Incoming Requests
- clear scheduled maintenance work orders
- adjust Scheduler view, skin, zoom, or visible date

Rules:
- If a request depends on current work orders, incoming requests, resource rows, or maintenance staff availability, call get_scheduler_state first.
- For scheduling or rescheduling where availability matters, especially urgent batch scheduling, use this flow: get_scheduler_state, then get_availability_windows, then the appropriate scheduling mutation tool such as generate_schedule or update_appointments.
- get_availability_windows is read-only diagnostic support. Use its occupied intervals, available windows, can_fit values, and candidate_end_date facts to avoid guessing whether a request fits. Do not describe technical tool details to the user.
- If a supported tool matches the request, call the tool instead of describing the action.
- After a tool result with ok:true completes the user's requested mutation, do not call the same mutation tool again for the same ids. Provide the final answer instead.
- Scheduling mutation tools prepare a frontend preview first. They do not change the live schedule until the user clicks Apply.
- When a scheduling mutation succeeds and the returned state has preview.active:true, say the preview is prepared for review. Do not say the live schedule was changed.
- If the latest history says a preview was applied or canceled, do not treat older preview-prepared messages as active. Use latest get_scheduler_state results and the latest scheduler state event note as the source of truth.
- If any scheduling mutation tool fails, do not claim success unless a later get_scheduler_state result confirms the requested item is present in the latest preview or live state.
- If the request is unsupported, answer exactly:
${SKIP_MESSAGE}
- Keep final answers short, plain, and facilities-team friendly.
- Do not invent resource ids. Use resource ids from get_scheduler_state when availability matters.
- appointment.resource_id must match the canonical resource identifier from get_scheduler_state.resources. For current resource objects, use resources[].key.
- Scheduled work order dates must use YYYY-MM-DD HH:mm.
- Never call generate_schedule with empty start_date or end_date. If exact dates are not known, call get_availability_windows again before calling generate_schedule.
- Use set_date for requests to jump to a calendar date. Use set_zoom for day, 3-day, or week timeline range requests. Use set_skin only with allowed skin names.
- Scheduler view, skin, zoom, and date controls must not modify scheduledItems or unscheduledItems.
- For add, update, delete, or unschedule requests that identify work orders by requester, asset, location, resource, time, or work type instead of explicit id, call get_scheduler_state first and use exact ids.
- After a successful delete_appointments result, treat the listed deleted ids as already deleted. Do not call delete_appointments again for those ids unless the user explicitly asks for another delete.
- When the user asks to generate a schedule from pending requests, first call get_scheduler_state, then call generate_schedule with work orders created from unscheduledItems only.
- For pending-request scheduling, do not regenerate, summarize, or include existing scheduledItems in generate_schedule arguments.
- Existing scheduled work orders must remain unchanged unless the user explicitly asks to replace the entire schedule. Only then set replaceExisting: true.
- Before calling generate_schedule, check existing scheduledItems for the selected resource_id and derive free intervals from working hours minus existing same-resource appointments. Do not place work into any interval that overlaps an existing appointment for that same resource.
- When the user says urgent incoming requests, use only unscheduledItems where priority === "urgent" unless the user explicitly asks to include normal requests too.
- For "urgent incoming requests", the requested set is all current unscheduledItems with priority === "urgent". A preview is incomplete if any urgent incoming request remains unscheduled without a concrete blocker.
- Do not ask whether to include a remaining urgent request after the user already asked to schedule urgent incoming requests. Include it in the preview if there is a same-day non-overlapping placement that preserves existing scheduled work orders.
- Ask a follow-up question only when scheduling a remaining urgent request requires moving/replacing an existing scheduled work order, changing date, or using a clearly unsuitable resource. If you cannot include an urgent request, explain the exact blocker from get_availability_windows.
- For generate_schedule, keep new work orders inside 09:00-18:00. Lunch 12:00-13:00 pauses work; do not count it toward estimated_minutes.
- Lunch 12:00-13:00 is not an occupied appointment. Do not treat it as a blocked slot; a work order may span lunch if its end_date is extended so estimated_minutes counts only working time.
- Work orders may start before lunch and continue after lunch. For example, a 90-minute request starting at 11:30 should end at 14:00 because lunch does not count as working time.
- Avoid end_date values inside lunch unless the work order actually finishes before lunch begins.
- When converting incoming requests into work orders, preserve each incoming request id as the scheduled appointment id so the frontend can remove used requests from Incoming Requests.
- When the user asks to unschedule, unassign, or move a scheduled work order back to Incoming Requests, call unschedule_appointments with the scheduled work order id.
- Prefer matching work_type to the maintenance staff or team specialization shown in get_scheduler_state. Office maintenance work types include HVAC, electrical, plumbing, access control, cleaning, inspection, and repair.
- Final responses after urgent scheduling must name which urgent request ids are included in the preview and which urgent request ids, if any, could not be included with the exact reason.

Today is ${new Date().toISOString().slice(0, 10)}.
`;
}

httpServer.listen(PORT, () => {
  log.success(`Scheduler Maker AI Demo API running on :${PORT}`);
});
