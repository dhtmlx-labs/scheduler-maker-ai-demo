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

type BrowserSpeechRecognitionEvent = Event & {
  results: {
    length: number;
    [index: number]: {
      length: number;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type BrowserSpeechRecognitionErrorEvent = Event & {
  error?: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  abort: () => void;
  start: () => void;
  stop: () => void;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onstart: (() => void) | null;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

const starterPrompts = [
  "Generate today's schedule from pending maintenance requests.",
  "Schedule all urgent requests first.",
  "Plan a balanced day with HVAC, electrical, plumbing, and access control work.",
  "Move the lobby access control work later this afternoon.",
  "Change the Scheduler skin to dark.",
  "Set the Timeline range to week.",
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

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | undefined {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
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

  if (cmd === "set_zoom") {
    return "set_zoom completed successfully. Confirm the Timeline range change briefly. Do not list scheduled or unscheduled items.";
  }

  if (cmd === "set_date") {
    return "set_date completed successfully. Confirm the date change briefly. Do not list scheduled or unscheduled items.";
  }

  if (cmd === "set_skin") {
    return "set_skin completed successfully. Confirm the skin change briefly. Do not list scheduled or unscheduled items.";
  }

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
        <button id="chat_voice" class="chat-voice" type="button" aria-label="Dictate message" title="Dictate message">Mic</button>
        <button id="chat_submit" class="chat-submit" type="submit">Send</button>
      </form>
      <div id="chat_voice_status" class="chat-voice-status" aria-live="polite"></div>
    </div>
  `;

  const status = container.querySelector<HTMLElement>("#chat_connection_status");
  const messages = container.querySelector<HTMLElement>("#chat_messages");
  const loader = container.querySelector<HTMLElement>("#chat_loader");
  const form = container.querySelector<HTMLFormElement>("#chat_form");
  const input = container.querySelector<HTMLInputElement>("#chat_input");
  const voice = container.querySelector<HTMLButtonElement>("#chat_voice");
  const voiceStatus = container.querySelector<HTMLElement>("#chat_voice_status");
  const submit = container.querySelector<HTMLButtonElement>("#chat_submit");
  const promptButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".prompt-pill"));

  if (!messages || !loader || !form || !input || !submit || !voice || !voiceStatus) {
    return;
  }

  const chatMessages = messages;
  const chatLoader = loader;
  const chatInput = input;
  const chatSubmit = submit;
  const chatVoice = voice;
  const chatVoiceStatus = voiceStatus;
  const SpeechRecognition = getSpeechRecognitionConstructor();
  let pending = false;
  let listening = false;
  let recognition: BrowserSpeechRecognition | null = null;

  function setPending(nextPending: boolean): void {
    pending = nextPending;
    chatInput.disabled = nextPending;
    chatSubmit.disabled = nextPending;
    chatVoice.disabled = nextPending || listening;
    promptButtons.forEach((button) => {
      button.disabled = nextPending;
    });
    chatLoader.hidden = !nextPending;
  }

  function setListening(nextListening: boolean): void {
    listening = nextListening;
    chatVoice.disabled = pending || nextListening;
    chatVoice.classList.toggle("chat-voice--listening", nextListening);
    chatVoice.textContent = nextListening ? "Listening" : "Mic";
  }

  function setVoiceStatus(message: string): void {
    chatVoiceStatus.textContent = message;
    chatVoiceStatus.hidden = message.length === 0;
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

  function startVoiceInput(): void {
    if (pending || listening) {
      return;
    }

    if (!SpeechRecognition) {
      setVoiceStatus("Voice input is not supported in this browser. Typed chat still works.");
      return;
    }

    recognition?.abort();
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setVoiceStatus("Listening. Speak a command, then review it before sending.");
    };

    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, index) => event.results[index]?.[0]?.transcript ?? "")
        .join(" ")
        .trim();

      if (!transcript) {
        setVoiceStatus("No speech was recognized. You can try again or type the command.");
        return;
      }

      chatInput.value = transcript;
      chatInput.focus();
      setVoiceStatus("Transcript added. Review or edit it, then send manually.");
    };

    recognition.onerror = (event) => {
      const reason = event.error ? ` (${event.error})` : "";
      setVoiceStatus(`Voice input stopped${reason}. Typed chat still works.`);
    };

    recognition.onend = () => {
      setListening(false);
    };

    try {
      recognition.start();
    } catch (error) {
      setListening(false);
      const message = error instanceof Error ? error.message : "Could not start voice input.";
      setVoiceStatus(message);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendUserMessage(chatInput.value);
  });

  chatVoice.addEventListener("click", () => {
    startVoiceInput();
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
