import "./style.css";

import { appState } from "./app-state.ts";
import { createCommandRunner } from "./command-runner.ts";
import {
  initIncomingRequestsPanel,
  renderIncomingRequestsPanel,
} from "./incoming-panel/incoming-requests.ts";

import {
  initSchedulerBoard,
  replaceScheduledItems,
} from "./scheduler/scheduler-board.ts";

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
  },
  renderIncomingRequests: refreshIncomingRequests,
});

Object.assign(window, { runSchedulerCommand: runCommand });
