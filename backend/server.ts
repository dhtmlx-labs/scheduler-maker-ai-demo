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
import { generateSystemPrompt } from "./prompt.js";
import {
  getDuplicateGenerateScheduleId,
  getStateIds,
  hasActivePreview,
  shouldFinalizeAfterGenerateSchedule,
} from "./requestGuards.js";
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
      const duplicateGenerateScheduleFailures = new Map<string, number>();

      async function emitFinalAssistantFromHistory(reason: string, turn: number): Promise<void> {
        const history = trimHistory(getHistory(socket.id));
        const startedAt = Date.now();

        log.info("[diagnostics] finalizing_without_tools_start", {
          socketId: socket.id,
          requestId,
          turn,
          reason,
          historyMessages: history.length,
        });

        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages: history,
        }, {
          signal: activeAbortController?.signal,
        });
        const durationMs = Date.now() - startedAt;
        const assistantMessage = completion.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error("OpenAI finalization response did not include an assistant message");
        }

        log.info("[diagnostics] finalizing_without_tools_complete", {
          socketId: socket.id,
          requestId,
          turn,
          reason,
          durationMs,
        });

        if (isCanceled(requestId)) {
          log.info("[cancel-request] ignored final assistant response after guarded finalization", {
            socketId: socket.id,
            requestId,
          });
          return;
        }

        const response: AssistantMsgPayload = {
          message: assistantMessage.content || "Preview prepared. Review it, then apply it or discard it.",
          requestId,
        };

        saveMessage(socket.id, {
          role: "assistant",
          content: response.message,
        });
        socket.emit("assistant_msg", response);
      }

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

            if (shouldFinalizeAfterGenerateSchedule(result, message)) {
              log.info("[diagnostics] generate_schedule_preview_complete", {
                socketId: socket.id,
                requestId,
                turn,
                toolIndex,
                toolCallId: call.id,
                scheduledIds: getStateIds(result.data, "scheduledItems"),
                unscheduledIds: getStateIds(result.data, "unscheduledItems"),
                summary: result.summary,
              });
              saveMessage(socket.id, {
                role: "system",
                content: "The latest generate_schedule call successfully prepared the requested preview. Do not call generate_schedule again for the same ids. Produce the final preview response from the latest state.",
              });
              await emitFinalAssistantFromHistory("generate_schedule preview complete", turn);
              return;
            }

            if (!result.ok && toolName === "generate_schedule") {
              const duplicateId = getDuplicateGenerateScheduleId(result.error);

              if (duplicateId) {
                const duplicateCount = (duplicateGenerateScheduleFailures.get(duplicateId) ?? 0) + 1;
                duplicateGenerateScheduleFailures.set(duplicateId, duplicateCount);
                log.warn("[diagnostics] duplicate_generate_schedule_retry", {
                  socketId: socket.id,
                  requestId,
                  turn,
                  toolIndex,
                  toolCallId: call.id,
                  duplicateId,
                  duplicateCount,
                  scheduledIds: getStateIds(result.data, "scheduledItems"),
                  unscheduledIds: getStateIds(result.data, "unscheduledItems"),
                });

                if (hasActivePreview(result.data)) {
                  saveMessage(socket.id, {
                    role: "system",
                    content: `generate_schedule failed because id ${duplicateId} is already included in the active preview. Do not call generate_schedule again for id ${duplicateId}. Produce the final preview summary from the latest preview-aware state data.`,
                  });
                  await emitFinalAssistantFromHistory("duplicate generate_schedule active-preview recovery", turn);
                  return;
                }
              }
            }
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

httpServer.listen(PORT, () => {
  log.success(`Scheduler Maker AI Demo API running on :${PORT}`);
});
