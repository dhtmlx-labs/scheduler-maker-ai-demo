# Scheduler Maker AI Demo

Office building maintenance scheduling demo built with DHTMLX Scheduler, Socket.IO, and OpenAI-compatible tool calling.

The app is intentionally chat-driven. A facilities coordinator can use natural language to inspect the schedule, prepare schedule previews from incoming maintenance requests, reschedule work orders, move scheduled work back to Incoming Requests, and adjust the Scheduler date, zoom, or skin.

## What It Shows

- DHTMLX Scheduler Timeline for scheduled maintenance work orders.
- A custom Incoming Requests panel for unscheduled maintenance requests.
- Frontend-owned live state plus preview state for AI-generated scheduling changes.
- Apply / Cancel flow for AI scheduling previews.
- Socket.IO tool-call loop between backend OpenAI responses and frontend Scheduler commands.
- Browser-native voice input that fills the chat box without auto-sending.

Scheduler renders only `scheduledItems`. The left Incoming Requests panel renders `unscheduledItems`; those cards are not DHTMLX Scheduler events. Dragging a card into the Timeline assigns resource/time and moves it into Scheduler. The reverse flow is available through chat by moving a scheduled work order back into Incoming Requests.

## Local Development

Install dependencies:

```bash
npm install
```

Create `.env` from the example and fill in your OpenAI-compatible credentials:

```bash
cp .env.example .env
```

Start backend and frontend in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Open:

- Frontend: http://localhost:3000
- Backend health: http://localhost:3001/health

Build all workspaces:

```bash
npm run build
```

## Environment Variables

Required:

- `OPENAI_API_KEY` - API key for the OpenAI-compatible chat completions endpoint.

Optional:

- `OPENAI_BASE_URL` - custom OpenAI-compatible base URL.
- `MODEL` - chat model name. Defaults to `gpt-5-nano`.
- `OPENAI_MODEL` - fallback model variable if `MODEL` is not set.
- `PORT` - backend port. Defaults to `3001`.
- `FRONTEND_ORIGIN` - allowed Socket.IO CORS origin. Defaults to `http://localhost:3000`.
- `VITE_SOCKET_URL` - frontend Socket.IO endpoint for local Vite builds. Defaults in code to `http://localhost:3001`.
- `VITE_SOCKET_URL_DOCKER` - Socket.IO URL baked into Docker frontend builds.
- `FRONTEND_ORIGIN_DOCKER` - backend CORS origin used by Docker Compose.

## Docker

Development containers with hot reload:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Production-style containers:

```bash
docker compose up --build
```

Default Docker ports:

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## AI Tool Flow

1. The user sends a chat message from the frontend.
2. Backend sends the message to the OpenAI-compatible API with Zod-generated tool schemas.
3. When the model calls a tool, backend emits a Socket.IO `tool_call` to the browser.
4. The frontend command runner validates and executes the command against live state or preview draft state.
5. The frontend ACK returns the latest Scheduler state and a concise summary to the backend.
6. Backend continues the tool loop or returns a final assistant message.

Mutating scheduling tools prepare a preview first. Live `appState` changes only when the user clicks Apply.

## DHTMLX Scheduler Note

This demo uses `@dhx/trial-scheduler`. Follow DHTMLX Scheduler licensing terms for evaluation, development, and production use.
