import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { Socket } from "socket.io";
import { ZodError } from "zod";
import { MAX_MESSAGES, TOOL_TIMEOUT_MS } from "./constants.js";
import { log } from "./logger.js";
import { toolSchemasByName, type ToolName } from "./schemaList.js";
import type { ChatMessages, ClientToolRequest, ClientToolResult } from "./types.js";

export const sessionMessagesByClient = new Map<string, ChatMessages>();

export function getMessagesHistoryByClient(
  socketId: string,
  systemPrompt: string,
): ChatMessages {
  let history = sessionMessagesByClient.get(socketId);

  if (!history) {
    history = [{ role: "system", content: systemPrompt }];
    sessionMessagesByClient.set(socketId, history);
  }

  return history;
}

export function getHistory(socketId: string): ChatMessages {
  const history = sessionMessagesByClient.get(socketId);

  if (!history?.length) {
    throw new Error(`Session history not found for socket: ${socketId}`);
  }

  return history;
}

export function trimHistory(history: ChatMessages, maxMessages = MAX_MESSAGES): ChatMessages {
  if (history.length <= 1) {
    return history;
  }

  const systemMessage = history[0];
  const rest = history.slice(1);
  const blocks: ChatMessages[] = [];
  let index = 0;

  while (index < rest.length) {
    const message = rest[index];

    if (
      message.role === "assistant" &&
      "tool_calls" in message &&
      message.tool_calls?.length
    ) {
      const block: ChatMessages = [message];
      index += 1;

      while (index < rest.length && rest[index].role === "tool") {
        block.push(rest[index]);
        index += 1;
      }

      blocks.push(block);
      continue;
    }

    if (message.role === "user") {
      const block: ChatMessages = [message];
      const next = rest[index + 1];

      if (
        next?.role === "assistant" &&
        !("tool_calls" in next && next.tool_calls?.length)
      ) {
        block.push(next);
        index += 2;
      } else {
        index += 1;
      }

      blocks.push(block);
      continue;
    }

    blocks.push([message]);
    index += 1;
  }

  return [systemMessage, ...blocks.slice(-maxMessages).flat()];
}

export function saveMessage(
  socketId: string,
  message: ChatCompletionMessageParam,
): void {
  const history = sessionMessagesByClient.get(socketId);

  if (!history) {
    throw new Error(`Session history not found for socket: ${socketId}`);
  }

  if (message.role === "assistant" && "tool_calls" in message && message.tool_calls) {
    history.push({
      role: "assistant",
      content: null,
      tool_calls: message.tool_calls,
    } as ChatCompletionAssistantMessageParam);
    return;
  }

  if (message.role === "tool" && "tool_call_id" in message && message.content != null) {
    history.push({
      role: "tool",
      content: message.content,
      tool_call_id: message.tool_call_id,
    } as ChatCompletionToolMessageParam);
    return;
  }

  switch (message.role) {
    case "system":
      history.push({
        role: "system",
        content: message.content,
      } as ChatCompletionSystemMessageParam);
      break;
    case "user":
      history.push({
        role: "user",
        content: message.content,
      } as ChatCompletionUserMessageParam);
      break;
    case "assistant":
      history.push({
        role: "assistant",
        content: message.content ?? null,
      });
      break;
    default:
      throw new Error(`Unsupported message role: ${message.role}`);
  }
}

export async function executeToolCall({
  socket,
  call,
}: {
  socket: Socket;
  call: ChatCompletionMessageToolCall;
}): Promise<ClientToolResult> {
  const cmd = validateToolName(call.function.name);
  const params = validateToolArguments(cmd, parseToolArguments(call.function.arguments));

  log.info("tool_call", cmd, params);

  return requestClientToolExecution(socket, {
    toolCallId: call.id,
    cmd,
    params,
  });
}

export function validateToolName(name: string | undefined): ToolName {
  if (!name || !(name in toolSchemasByName)) {
    throw new Error(`Unsupported tool name: ${name || "missing"}`);
  }

  return name as ToolName;
}

export function parseToolArguments(rawArgs: string): Record<string, unknown> {
  if (!rawArgs?.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArgs) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Tool arguments are not valid JSON: ${error.message}`);
    }

    throw error;
  }
}

export function validateToolArguments(
  cmd: ToolName,
  args: Record<string, unknown>,
): unknown {
  const result = toolSchemasByName[cmd].safeParse(args);

  if (!result.success) {
    throw new Error(`Invalid arguments for ${cmd}: ${formatZodError(result.error)}`);
  }

  return result.data;
}

function requestClientToolExecution(
  socket: Socket,
  payload: ClientToolRequest,
): Promise<ClientToolResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for tool result: ${payload.cmd}`));
    }, TOOL_TIMEOUT_MS);

    socket.emit("tool_call", payload, (result: ClientToolResult | undefined) => {
      clearTimeout(timeout);

      if (!result) {
        reject(new Error(`No tool result received for: ${payload.cmd}`));
        return;
      }

      log.info("tool_result", summarizeToolResult(result));
      resolve(result);
    });
  });
}

function summarizeToolResult(result: ClientToolResult): Record<string, unknown> {
  if (!result.ok) {
    return {
      ok: false,
      cmd: result.cmd,
      error: result.error,
      toolCallId: result.toolCallId,
    };
  }

  const data = result.data as { scheduledItems?: Array<{ id: unknown }>; unscheduledItems?: Array<{ id: unknown }> } | undefined;

  return {
    ok: true,
    cmd: result.cmd,
    summary: result.summary,
    toolCallId: result.toolCallId,
    scheduledIds: data?.scheduledItems?.map((item) => item.id),
    unscheduledIds: data?.unscheduledItems?.map((item) => item.id),
  };
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
