import DOMPurify from "dompurify";
import { marked } from "marked";

export type ChatMessageKind = "user" | "assistant" | "system" | "success" | "warning";

export function sanitizeText(value: string): string {
  return DOMPurify.sanitize(value);
}

export function renderMarkdown(value: string): string {
  return DOMPurify.sanitize(marked.parse(value, { async: false }) as string);
}

export function appendChatMessage(messages: HTMLElement, kind: ChatMessageKind, html: string): void {
  const item = document.createElement("div");
  item.className = `chat-message chat-message--${kind}`;
  item.innerHTML = `<div class="chat-message__bubble">${html}</div>`;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}
