import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type HealthResponse = {
  ok: true;
  app: "scheduler-maker-ai-demo";
};

export type UserMsgPayload = {
  message: string;
  requestId?: string;
  state?: unknown;
};

export type CancelRequestPayload = {
  requestId: string;
};

export type SchedulerStateEventPayload = {
  type: "preview_applied" | "preview_canceled";
  state?: unknown;
  scheduledIds?: Array<string | number>;
  unscheduledIds?: Array<string | number>;
};

export type AssistantMsgPayload = {
  message: string;
  kind?: "echo" | "error" | "busy";
  requestId?: string;
};

export type ClientToolRequest = {
  toolCallId: string;
  requestId?: string;
  cmd: string;
  params: unknown;
};

export type ClientToolResult =
  | {
      ok: true;
      cmd: string;
      data?: unknown;
      result?: unknown;
      summary?: string;
      toolCallId?: string;
    }
  | {
      ok: false;
      cmd: string;
      error: string;
      data?: unknown;
      summary?: string;
      toolCallId?: string;
    };

export type ChatMessage = ChatCompletionMessageParam;
export type ChatMessages = ChatMessage[];
