export const PORT = Number(process.env.PORT || 3001);
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
export const MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";
export const TOOL_TIMEOUT_MS = 15_000;
export const MAX_MESSAGES = 20;
export const MAX_TURNS = 10;
