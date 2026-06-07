import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Socket } from "socket.io-client";

import type { CommandResult, SchedulerState } from "../scheduler/types.ts";

import "./chat-widget.css";

type ToolCallPayload = {
  toolCallId: string;
  cmd: string;
  params: unknown;
};

type InitChatOptions = {
  socket: Socket;
  runCommand: (cmd: string, params?: any) => CommandResult;
  getSchedulerState: () => SchedulerState;
};

const starterPrompts = [
  "Generate today's schedule from pending maintenance requests.",
  "Plan a balanced day with HVAC, electrical, plumbing, and access control work.",
  "Move the lobby access control work later this afternoon.",
];

function isToolCallPayload(payload: unknown): payload is ToolCallPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const maybePayload = payload as Partial<ToolCallPayload>;

  return typeof maybePayload.toolCallId === "string" && typeof maybePayload.cmd === "string";
}

function sanitizeText(value: string): string {
  return DOMPurify.sanitize(value);
}

function renderMarkdown(value: string): string {
  return DOMPurify.sanitize(marked.parse(value, { async: false }) as string);
}

function extractIds(params: unknown): Array<string | number> {
  if (!params || typeof params !== "object") {
    return [];
  }

  const maybeParams = params as {
    ids?: Array<string | number>;
    appointments?: Array<{ id?: string | number }>;
  };

  return maybeParams.ids ?? maybeParams.appointments?.flatMap((item) => (
    item.id == null ? [] : [item.id]
  )) ?? [];
}

function summarizeToolResult(cmd: string, params: unknown, state: SchedulerState): string {
  const scheduledIds = state.scheduledItems.map((item) => item.id).join(", ") || "none";
  const unscheduledIds = state.unscheduledItems.map((item) => item.id).join(", ") || "none";

  if (cmd === "delete_appointments") {
    const deletedIds = extractIds(params).join(", ") || "unknown";

    return [
      `delete_appointments completed successfully. Deleted ids: ${deletedIds}.`,
      `Current scheduled ids: ${scheduledIds}.`,
      "Do not call delete_appointments again for the same ids unless the user explicitly asks for another delete.",
    ].join(" ");
  }

  if (cmd === "unschedule_appointments") {
    const restoredIds = extractIds(params).join(", ") || "unknown";

    return [
      `unschedule_appointments completed successfully. Restored incoming request ids: ${restoredIds}.`,
      `Current scheduled ids: ${scheduledIds}. Current unscheduled ids: ${unscheduledIds}.`,
    ].join(" ");
  }

  return `${cmd} completed successfully. Current scheduled ids: ${scheduledIds}. Current unscheduled ids: ${unscheduledIds}.`;
}

export function initChat({ socket, runCommand, getSchedulerState }: InitChatOptions): void {
  const container = document.querySelector<HTMLElement>("#chat_panel");

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="chat-widget">
      <div class="panel-header">
        <div>
          <p class="eyebrow">AI Assistant</p>
          <h2>Facilities Chat</h2>
        </div>
        <span id="chat_connection_status" class="chat-status">Connecting</span>
      </div>
      <div id="chat_messages" class="chat-messages" aria-live="polite"></div>
      <div id="chat_loader" class="chat-loader" hidden>
        <span class="chat-loader__dot"></span>
        <span class="chat-loader__text">Waiting for assistant</span>
      </div>
      <div class="chat-prompts" aria-label="Starter prompts">
        ${starterPrompts
          .map((prompt) => `<button class="prompt-pill" type="button">${sanitizeText(prompt)}</button>`)
          .join("")}
      </div>
      <form id="chat_form" class="chat-form">
        <input id="chat_input" class="chat-input" type="text" autocomplete="off" placeholder="Ask the facilities assistant..." />
        <button id="chat_submit" class="chat-submit" type="submit">Send</button>
      </form>
    </div>
  `;

  const status = container.querySelector<HTMLElement>("#chat_connection_status");
  const messages = container.querySelector<HTMLElement>("#chat_messages");
  const loader = container.querySelector<HTMLElement>("#chat_loader");
  const form = container.querySelector<HTMLFormElement>("#chat_form");
  const input = container.querySelector<HTMLInputElement>("#chat_input");
  const submit = container.querySelector<HTMLButtonElement>("#chat_submit");
  const promptButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".prompt-pill"));

  if (!messages || !loader || !form || !input || !submit) {
    return;
  }

  const chatMessages = messages;
  const chatLoader = loader;
  const chatInput = input;
  const chatSubmit = submit;
  let pending = false;

  function setPending(nextPending: boolean): void {
    pending = nextPending;
    chatInput.disabled = nextPending;
    chatSubmit.disabled = nextPending;
    promptButtons.forEach((button) => {
      button.disabled = nextPending;
    });
    chatLoader.hidden = !nextPending;
  }

  function setStatus(label: string, connected: boolean): void {
    if (!status) {
      return;
    }

    status.textContent = label;
    status.classList.toggle("chat-status--connected", connected);
  }

  function scrollMessages(): void {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendMessage(kind: "user" | "assistant" | "system", html: string): void {
    const item = document.createElement("div");
    item.className = `chat-message chat-message--${kind}`;
    item.innerHTML = `<div class="chat-message__bubble">${html}</div>`;
    chatMessages.appendChild(item);
    scrollMessages();
  }

  function sendUserMessage(message: string): void {
    const cleanMessage = message.trim();

    if (!cleanMessage || pending) {
      return;
    }

    appendMessage("user", sanitizeText(cleanMessage));
    chatInput.value = "";
    setPending(true);
    socket.emit("user_msg", {
      message: cleanMessage,
      state: getSchedulerState(),
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendUserMessage(chatInput.value);
  });

  promptButtons.forEach((button) => {
    button.addEventListener("click", () => {
      sendUserMessage(button.textContent ?? "");
    });
  });

  socket.on("connect", () => {
    console.info(`Socket.IO connected: ${socket.id}`);
    setStatus("Connected", true);
  });

  socket.on("disconnect", () => {
    console.info("Socket.IO disconnected");
    setStatus("Disconnected", false);
    setPending(false);
  });

  socket.on("connect_error", (error) => {
    console.warn("Socket.IO connection error", error.message);
    setStatus("Offline", false);
  });

  socket.on("assistant_msg", (payload: string | { message?: string }) => {
    const message = typeof payload === "string" ? payload : payload.message;

    setPending(false);
    appendMessage("assistant", renderMarkdown(message || "No response received."));
  });

  socket.on("tool_call", (payload: unknown, ack?: (response: unknown) => void) => {
    if (!isToolCallPayload(payload)) {
      ack?.({
        ok: false,
        cmd: "unknown",
        error: "Invalid tool_call payload",
      });
      return;
    }

    try {
      const result = runCommand(payload.cmd, payload.params);
      const state = getSchedulerState();
      const summary = summarizeToolResult(payload.cmd, payload.params, state);
      console.info("[scheduler-tool-result]", summary);
      ack?.({
        ok: true,
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        summary,
        data: state,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tool error";
      appendMessage("system", sanitizeText(`Tool call failed: ${message}`));
      ack?.({
        ok: false,
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        error: message,
      });
    }
  });

  appendMessage(
    "assistant",
    renderMarkdown("Ready when you are. I can help inspect the schedule, plan incoming maintenance requests, or adjust work orders."),
  );
}
