import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Socket } from "socket.io-client";

import type { AvailabilityResult, CommandResult, SchedulerState } from "../scheduler/types.ts";

import "./chat-widget.css";

type ToolCallPayload = {
  toolCallId: string;
  requestId?: string;
  cmd: string;
  params: unknown;
};

type InitChatOptions = {
  socket: Socket;
  runCommand: (cmd: string, params?: any) => CommandResult;
  getSchedulerState: () => SchedulerState;
  onApplyPreview: () => boolean;
  onCancelPreview: () => boolean;
  onPendingChange?: (pending: boolean) => void;
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
  "Schedule all urgent incoming requests first.",
  "Move the access control work later this afternoon.",
  "Change the Scheduler skin to dark.",
  "Set the Timeline range to week.",
];

let previewActionsCard: HTMLElement | null = null;
let previewApplyButton: HTMLButtonElement | null = null;
let previewCancelButton: HTMLButtonElement | null = null;
let previewActionsHost: HTMLElement | null = null;
let previewActionsActive = false;
let chatRequestPending = false;

function createRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function renderChatPreviewActions(active: boolean): void {
  previewActionsActive = active;

  if (!previewActionsHost) {
    return;
  }

  previewActionsCard?.remove();
  previewActionsCard = null;
  previewApplyButton = null;
  previewCancelButton = null;

  if (!active || chatRequestPending) {
    return;
  }

  const item = document.createElement("div");
  item.className = "chat-message chat-message--preview-actions";
  item.innerHTML = `
    <section class="chat-preview-actions" aria-live="polite">
      <div>
        <h3>Schedule preview</h3>
        <p>Review the AI proposal, then apply it or discard it.</p>
      </div>
      <div class="chat-preview-actions__buttons">
        <button class="chat-preview-actions__button chat-preview-actions__button--apply" type="button">Apply</button>
        <button class="chat-preview-actions__button" type="button">Cancel</button>
      </div>
    </section>
  `;

  previewActionsHost.appendChild(item);
  previewActionsCard = item;
  previewApplyButton = item.querySelector<HTMLButtonElement>(".chat-preview-actions__button--apply");
  previewCancelButton = item.querySelector<HTMLButtonElement>(".chat-preview-actions__button:not(.chat-preview-actions__button--apply)");

  previewApplyButton?.addEventListener("click", () => {
    previewActionsHost?.dispatchEvent(new CustomEvent("preview-apply"));
  });

  previewCancelButton?.addEventListener("click", () => {
    previewActionsHost?.dispatchEvent(new CustomEvent("preview-cancel"));
  });

  if (previewApplyButton) {
    previewApplyButton.disabled = false;
  }

  if (previewCancelButton) {
    previewCancelButton.disabled = false;
  }

  previewActionsHost.scrollTop = previewActionsHost.scrollHeight;
}

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

function summarizeAvailabilityResult(result: unknown): string {
  const availability = result as AvailabilityResult | undefined;

  if (!availability?.resources?.length) {
    return "get_availability_windows completed. No resource availability rows were returned.";
  }

  const resourceSummaries = availability.resources.map((resource) => {
    const fittingWindows = resource.windows.filter((window) => window.can_fit);
    const windowSummary = fittingWindows.length
      ? fittingWindows
          .slice(0, 4)
          .map((window) => `${window.start_date}-${window.end_date}${window.candidate_end_date ? ` candidate_end_date ${window.candidate_end_date}` : ""}`)
          .join("; ")
      : "no fitting windows";

    return `${resource.resource_id}: occupied ${resource.occupied.length}; ${windowSummary}`;
  }).join(" | ");

  return [
    `get_availability_windows completed for ${availability.date}.`,
    `Working hours ${availability.working_hours.start}-${availability.working_hours.end}.`,
    `Lunch ${availability.lunch.start}-${availability.lunch.end} is ${availability.lunch.behavior}.`,
    resourceSummaries,
    "Use these facts to choose proposed appointments; this tool did not mutate live or preview state.",
  ].join(" ");
}

function summarizeToolResult(cmd: string, params: unknown, state: SchedulerState, result?: CommandResult): string {
  const scheduledIds = state.scheduledItems.map((item) => item.id).join(", ") || "none";
  const unscheduledIds = state.unscheduledItems.map((item) => item.id).join(", ") || "none";
  const previewPrefix = state.preview?.active
    ? "Preview prepared. Live schedule is unchanged until the user clicks Apply."
    : "";

  if (cmd === "get_availability_windows") {
    return summarizeAvailabilityResult(result?.data);
  }

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
      previewPrefix || `delete_appointments completed successfully. Deleted ids: ${deletedIds}.`,
      previewPrefix ? `Preview deleted ids: ${deletedIds}.` : "",
      `Current scheduled ids: ${scheduledIds}.`,
      "Do not call delete_appointments again for the same ids unless the user explicitly asks for another delete.",
    ].filter(Boolean).join(" ");
  }

  if (cmd === "unschedule_appointments") {
    const restoredIds = extractIds(params).join(", ") || "unknown";

    return [
      previewPrefix || `unschedule_appointments completed successfully. Restored incoming request ids: ${restoredIds}.`,
      previewPrefix ? `Preview restored incoming request ids: ${restoredIds}.` : "",
      `Current scheduled ids: ${scheduledIds}. Current unscheduled ids: ${unscheduledIds}.`,
    ].filter(Boolean).join(" ");
  }

  if (cmd === "generate_schedule") {
    const generatedIds = extractIds(params);
    const generatedIdList = generatedIds.join(", ") || "unknown";
    const remainingUrgentItems = state.unscheduledItems.filter((item) => item.priority === "urgent");
    const remainingUrgentSummary = remainingUrgentItems
      .map((item) => `${item.id} (${item.text}, ${item.estimated_minutes} min, ${item.work_type})`)
      .join("; ");

    return [
      previewPrefix || "generate_schedule completed successfully.",
      `Preview included generated request ids: ${generatedIdList}.`,
      `Preview scheduled ids: ${scheduledIds}. Preview unscheduled ids: ${unscheduledIds}.`,
      remainingUrgentItems.length
        ? `Urgent incoming requests still pending: ${remainingUrgentSummary}. If the user asked to schedule urgent incoming requests, this preview is incomplete unless each remaining urgent request has a concrete blocker. Continue planning any remaining urgent request that can fit today without moving/replacing existing scheduled work orders; ask only if moving/replacing work, changing date, or using an unsuitable resource is required.`
        : "No urgent incoming requests remain pending. If the user asked to schedule urgent incoming requests, the urgent preview set is complete.",
      "Reply that a preview is ready for review; do not say the live schedule changed. State which urgent request ids are included and which, if any, could not be included with the exact reason.",
    ].filter(Boolean).join(" ");
  }

  if (previewPrefix) {
    return `${previewPrefix} Preview scheduled ids: ${scheduledIds}. Preview unscheduled ids: ${unscheduledIds}. Reply that a preview is ready for review; do not say the live schedule changed.`;
  }

  return `${cmd} completed successfully. Current scheduled ids: ${scheduledIds}. Current unscheduled ids: ${unscheduledIds}.`;
}

export function initChat({
  socket,
  runCommand,
  getSchedulerState,
  onApplyPreview,
  onCancelPreview,
  onPendingChange,
}: InitChatOptions): void {
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
      <div id="chat_cancel_dialog" class="chat-cancel-dialog" hidden>
        <div class="chat-cancel-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="chat_cancel_title" aria-describedby="chat_cancel_body">
          <h3 id="chat_cancel_title">Stop current request?</h3>
          <p id="chat_cancel_body">The assistant is still processing. Any unfinished work from this request will be discarded.</p>
          <div class="chat-cancel-dialog__actions">
            <button id="chat_cancel_continue" class="chat-cancel-dialog__button chat-cancel-dialog__button--primary" type="button">Continue waiting</button>
            <button id="chat_cancel_stop" class="chat-cancel-dialog__button chat-cancel-dialog__button--danger" type="button">Stop request</button>
          </div>
        </div>
      </div>
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
  const cancelDialog = container.querySelector<HTMLElement>("#chat_cancel_dialog");
  const cancelTitle = container.querySelector<HTMLElement>("#chat_cancel_title");
  const cancelBody = container.querySelector<HTMLElement>("#chat_cancel_body");
  const cancelContinue = container.querySelector<HTMLButtonElement>("#chat_cancel_continue");
  const cancelStop = container.querySelector<HTMLButtonElement>("#chat_cancel_stop");
  const promptButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".prompt-pill"));

  if (!messages || !loader || !form || !input || !submit || !voice || !voiceStatus || !cancelDialog || !cancelTitle || !cancelBody || !cancelContinue || !cancelStop) {
    return;
  }

  const requestCancelDialog = cancelDialog;
  const requestCancelTitle = cancelTitle;
  const requestCancelBody = cancelBody;
  const requestCancelContinue = cancelContinue;
  const requestCancelStop = cancelStop;
  previewActionsHost = messages;
  renderChatPreviewActions(previewActionsActive);

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
  let currentRequestId: string | null = null;
  let toolStartedForCurrentRequest = false;
  const canceledRequestIds = new Set<string>();

  function setPending(nextPending: boolean): void {
    pending = nextPending;
    chatRequestPending = nextPending;
    onPendingChange?.(nextPending);
    chatInput.disabled = nextPending;
    chatSubmit.disabled = false;
    chatSubmit.textContent = nextPending ? "Cancel" : "Send";
    chatSubmit.classList.toggle("chat-submit--cancel", nextPending);
    chatVoice.disabled = nextPending || listening;
    renderChatPreviewActions(previewActionsActive);
    promptButtons.forEach((button) => {
      button.disabled = nextPending;
    });
    chatLoader.hidden = !nextPending;
  }

  function closeCancelDialog(): void {
    requestCancelDialog.hidden = true;
  }

  function openCancelDialog(): void {
    requestCancelTitle.textContent = "Stop current request?";
    requestCancelBody.textContent = toolStartedForCurrentRequest
      ? "The assistant has already started processing scheduling operations. Any unfinished planning work from this request will be discarded."
      : "The assistant is still processing. Any unfinished work from this request will be discarded.";
    requestCancelDialog.hidden = false;
    requestCancelContinue.focus();
  }

  function stopCurrentRequest(): void {
    if (!currentRequestId) {
      closeCancelDialog();
      return;
    }

    const requestId = currentRequestId;
    canceledRequestIds.add(requestId);
    socket.emit("cancel_request", { requestId });
    closeCancelDialog();
    setPending(false);
    currentRequestId = null;
    toolStartedForCurrentRequest = false;
    appendMessage("warning", sanitizeText("Request canceled."));
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

  function appendMessage(kind: "user" | "assistant" | "system" | "success" | "warning", html: string): void {
    const item = document.createElement("div");
    item.className = `chat-message chat-message--${kind}`;
    item.innerHTML = `<div class="chat-message__bubble">${html}</div>`;
    chatMessages.appendChild(item);
    scrollMessages();
  }

  function sendUserMessage(message: string): void {
    const cleanMessage = message.trim();

    if (pending) {
      openCancelDialog();
      return;
    }

    if (!cleanMessage) {
      return;
    }

    const requestId = createRequestId();
    currentRequestId = requestId;
    toolStartedForCurrentRequest = false;
    appendMessage("user", sanitizeText(cleanMessage));
    chatInput.value = "";
    setPending(true);
    socket.emit("user_msg", {
      requestId,
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

  requestCancelContinue.addEventListener("click", () => {
    closeCancelDialog();
  });

  requestCancelStop.addEventListener("click", () => {
    stopCurrentRequest();
  });

  requestCancelDialog.addEventListener("click", (event) => {
    if (event.target === requestCancelDialog) {
      closeCancelDialog();
    }
  });

  chatVoice.addEventListener("click", () => {
    startVoiceInput();
  });

  chatMessages.addEventListener("preview-apply", () => {
    if (!pending && onApplyPreview()) {
      renderChatPreviewActions(false);
      appendMessage("success", sanitizeText("Preview applied. Changes are now live."));
    }
  });

  chatMessages.addEventListener("preview-cancel", () => {
    if (!pending && onCancelPreview()) {
      renderChatPreviewActions(false);
      appendMessage("warning", sanitizeText("Preview discarded. Live schedule was not changed."));
    }
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
    closeCancelDialog();
    setPending(false);
  });

  socket.on("connect_error", (error) => {
    console.warn("Socket.IO connection error", error.message);
    setStatus("Offline", false);
  });

  socket.on("assistant_msg", (payload: string | { message?: string; requestId?: string }) => {
    const message = typeof payload === "string" ? payload : payload.message;
    const requestId = typeof payload === "string" ? undefined : payload.requestId;

    if (requestId && canceledRequestIds.has(requestId)) {
      canceledRequestIds.delete(requestId);
      return;
    }

    if (requestId && currentRequestId && requestId !== currentRequestId) {
      return;
    }

    appendMessage("assistant", renderMarkdown(message || "No response received."));
    setPending(false);
    currentRequestId = null;
    toolStartedForCurrentRequest = false;
  });

  socket.on("tool_call", (payload: unknown, ack?: (response: unknown) => void) => {
    console.info("[scheduler-diagnostics] incoming tool_call payload", payload);

    if (!isToolCallPayload(payload)) {
      ack?.({
        ok: false,
        cmd: "unknown",
        error: "Invalid tool_call payload",
      });
      return;
    }

    if (payload.requestId && canceledRequestIds.has(payload.requestId)) {
      ack?.({
        ok: false,
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        error: "Request was canceled by the user.",
      });
      return;
    }

    if (payload.requestId && currentRequestId && payload.requestId !== currentRequestId) {
      ack?.({
        ok: false,
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        error: "Ignoring stale tool call for an older request.",
      });
      return;
    }

    try {
      console.info("[scheduler-diagnostics] executing tool_call", {
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        args: payload.params,
      });
      toolStartedForCurrentRequest = true;
      const result = runCommand(payload.cmd, payload.params);
      const state = getSchedulerState();
      const summary = summarizeToolResult(payload.cmd, payload.params, state, result);
      console.info("[scheduler-diagnostics] tool_call success", {
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        result,
        state,
        summary,
      });
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
      console.error("[scheduler-diagnostics] tool_call failure", {
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        args: payload.params,
        error: message,
      });
      appendMessage("system", sanitizeText(`Tool call failed: ${message}`));
      const state = getSchedulerState();
      ack?.({
        ok: false,
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        error: `${message}. No successful scheduling change should be claimed unless a later get_scheduler_state confirms it.`,
        summary: `${payload.cmd} failed. No successful scheduling change should be claimed. Current state included for grounding.`,
        data: state,
      });
    }
  });

  appendMessage(
    "assistant",
    renderMarkdown("Ready when you are. I can help inspect the schedule, plan incoming maintenance requests, or adjust work orders."),
  );
}
