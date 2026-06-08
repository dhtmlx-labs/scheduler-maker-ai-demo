import "./style.css";

import { io } from "socket.io-client";

import { appState } from "./app-state.ts";
import { initChat } from "./chat-widget/chat-widget.ts";
import { createCommandRunner } from "./command-runner.ts";
import {
  initIncomingRequestsPanel,
  renderIncomingRequestsPanel,
} from "./incoming-panel/incoming-requests.ts";

import {
  initSchedulerBoard,
  replaceScheduledItems,
  setSchedulerDate,
  setSchedulerSkin,
  setSchedulerView,
  setSchedulerZoom,
} from "./scheduler/scheduler-board.ts";
import type { SchedulerState } from "./scheduler/types.ts";

import { wireSchedulerDropTarget } from "./scheduler/scheduler-dnd.ts";

function refreshIncomingRequests(): void {
  renderIncomingRequestsPanel(appState.unscheduledItems);
}

initIncomingRequestsPanel(() => appState.unscheduledItems);
initSchedulerBoard(appState.scheduledItems);
wireSchedulerDropTarget(refreshIncomingRequests);

const runCommand = createCommandRunner({
  state: appState,
  scheduler: {
    replaceScheduledItems,
    setDate: setSchedulerDate,
    setSkin: setSchedulerSkin,
    setView: setSchedulerView,
    setZoom: setSchedulerZoom,
  },
  renderIncomingRequests: refreshIncomingRequests,
});

Object.assign(window, { runSchedulerCommand: runCommand });

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";

const socket = io(SOCKET_URL);

initChat({
  socket,
  runCommand,
  getSchedulerState: () => runCommand("get_scheduler_state").data as SchedulerState,
});
