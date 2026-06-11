import type { Socket } from "socket.io-client";

import type { CommandResult, SchedulerState } from "../scheduler/types.ts";
import { renderCommandGuideModal, renderContextualSuggestions, renderPromptButtons } from "./command-guide.ts";
import { appendChatMessage, renderMarkdown, sanitizeText, type ChatMessageKind } from "./message-rendering.ts";
import { createRequestCancelDialog } from "./request-cancel-dialog.ts";
import { getSpeechRecognitionConstructor, type BrowserSpeechRecognition } from "./speech-recognition.ts";
import { getDuplicateGenerateScheduleRecovery, summarizeToolResult } from "./tool-summaries.ts";

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
        <div class="chat-header-actions">
          <button id="chat_command_guide_open" class="chat-help" type="button" aria-haspopup="dialog">Guide</button>
          <span id="chat_connection_status" class="chat-status">Connecting</span>
        </div>
      </div>
      <div id="chat_messages" class="chat-messages" aria-live="polite"></div>
      <div id="chat_loader" class="chat-loader" hidden>
        <span class="chat-loader__dot"></span>
        <span class="chat-loader__text">Waiting for assistant</span>
      </div>
      <div class="chat-prompts" aria-label="Starter prompts">
        ${renderPromptButtons(starterPrompts)}
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
      ${renderCommandGuideModal()}
    </div>
  `;

  const status = container.querySelector<HTMLElement>("#chat_connection_status");
  const commandGuideOpen = container.querySelector<HTMLButtonElement>("#chat_command_guide_open");
  const commandGuide = container.querySelector<HTMLElement>("#chat_command_guide");
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

  if (!messages || !loader || !form || !input || !submit || !voice || !voiceStatus || !cancelDialog || !cancelTitle || !cancelBody || !cancelContinue || !cancelStop || !commandGuideOpen || !commandGuide) {
    return;
  }

  const chatCommandGuideOpen = commandGuideOpen;
  const chatCommandGuide = commandGuide;
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
  let scheduleSuggestionsPending = false;
  let scheduleSuggestionsShown = false;
  const canceledRequestIds = new Set<string>();
  const requestCancelController = createRequestCancelDialog({
    dialog: cancelDialog,
    title: cancelTitle,
    body: cancelBody,
    continueButton: cancelContinue,
    stopButton: cancelStop,
    hasToolStarted: () => toolStartedForCurrentRequest,
    onStop: stopCurrentRequest,
  });

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
    requestCancelController.close();
  }

  function openCancelDialog(): void {
    requestCancelController.open();
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

  function appendMessage(kind: ChatMessageKind, html: string): void {
    appendChatMessage(chatMessages, kind, html);
  }

  function closeCommandGuide(): void {
    chatCommandGuide.hidden = true;
    chatCommandGuideOpen.focus();
  }

  function openCommandGuide(): void {
    chatCommandGuide.hidden = false;
    chatCommandGuide.querySelector<HTMLButtonElement>(".command-guide__close")?.focus();
  }

  async function copyPrompt(prompt: string, button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt);
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1000);
    } catch {
      chatInput.value = prompt;
      chatInput.focus();
      button.textContent = "Inserted";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1000);
    }
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

  chatCommandGuideOpen.addEventListener("click", () => {
    openCommandGuide();
  });

  chatCommandGuide.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest("[data-command-guide-close]")) {
      closeCommandGuide();
      return;
    }

    const copyButton = target.closest<HTMLButtonElement>(".command-guide__copy");

    if (copyButton) {
      void copyPrompt(copyButton.dataset.prompt ?? "", copyButton);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !chatCommandGuide.hidden) {
      closeCommandGuide();
    }
  });

  chatVoice.addEventListener("click", () => {
    startVoiceInput();
  });

  chatMessages.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const promptButton = target.closest<HTMLButtonElement>(".prompt-pill");

    if (promptButton) {
      sendUserMessage(promptButton.textContent ?? "");
    }
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

    if (scheduleSuggestionsPending && !scheduleSuggestionsShown) {
      appendMessage("assistant", renderContextualSuggestions());
      scheduleSuggestionsShown = true;
    }

    scheduleSuggestionsPending = false;
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

      if (payload.cmd === "generate_schedule") {
        scheduleSuggestionsPending = true;
      }

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
      const duplicateRecovery = getDuplicateGenerateScheduleRecovery(payload.cmd, message, state);
      ack?.({
        ok: false,
        toolCallId: payload.toolCallId,
        cmd: payload.cmd,
        error: [
          message,
          duplicateRecovery,
          "No successful scheduling change should be claimed unless current state data confirms it.",
        ].filter(Boolean).join(" "),
        summary: duplicateRecovery
          ?? `${payload.cmd} failed. No successful scheduling change should be claimed. Current state included for grounding.`,
        data: state,
      });
    }
  });

  appendMessage(
    "assistant",
    renderMarkdown("Ready when you are. I can help inspect the schedule, plan incoming maintenance requests, or adjust work orders."),
  );
}
