import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type HealthResponse = {
  ok: true;
  app: "scheduler-maker-ai-demo";
};

export type UserMsgPayload = {
  message: string;
  state?: unknown;
};

export type AssistantMsgPayload = {
  message: string;
  kind?: "echo" | "error" | "busy";
};

export type ClientToolRequest = {
  toolCallId: string;
  cmd: string;
  params: unknown;
};

export type ClientToolResult =
  | {
      ok: true;
      cmd: string;
      data?: unknown;
      result?: unknown;
      toolCallId?: string;
    }
  | {
      ok: false;
      cmd: string;
      error: string;
      toolCallId?: string;
    };

export type ChatMessage = ChatCompletionMessageParam;
export type ChatMessages = ChatMessage[];
