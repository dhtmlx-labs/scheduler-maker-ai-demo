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
