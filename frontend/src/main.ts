import "./style.css";

import { io } from "socket.io-client";

import { appState } from "./app-state.ts";
import { initChat, renderChatPreviewActions } from "./chat-widget/chat-widget.ts";
import { createCommandRunner } from "./command-runner.ts";
import {
  initIncomingRequestsPanel,
  renderIncomingRequestsPanel,
  setIncomingRequestsDragDisabled,
} from "./incoming-panel/incoming-requests.ts";

import {
  initSchedulerBoard,
  replaceScheduledItems,
  setSchedulerDate,
  setSchedulerPreviewMode,
  setSchedulerReadOnly,
  setSchedulerSkin,
  setSchedulerView,
  setSchedulerZoom,
} from "./scheduler/scheduler-board.ts";
import type { ScheduledItem, SchedulerItemId, SchedulerState } from "./scheduler/types.ts";
import { getItemIds, summarizeStateIds } from "./scheduler/state-debug.ts";
import {
  applyPreviewToLive,
  buildScheduledPreviewItems,
  buildUnscheduledPreviewItems,
  cancelPreview,
  cloneSchedulerState,
  getPlanningState,
  getPreviewAwareState,
  previewSession,
  startPreviewFromLive,
} from "./preview/preview-session.ts";

import { wireSchedulerDropTarget } from "./scheduler/scheduler-dnd.ts";

let aiRequestPending = false;

function isSchedulingUiLocked(): boolean {
  return previewSession.active || aiRequestPending;
}

function refreshIncomingRequests(): void {
  setIncomingRequestsDragDisabled(isSchedulingUiLocked());

  const items = previewSession.active
    ? buildUnscheduledPreviewItems()
    : getPlanningState(appState).unscheduledItems;

  renderIncomingRequestsPanel(items);
}

function renderSchedulerFromCurrentState(): void {
  replaceScheduledItems(previewSession.active ? buildScheduledPreviewItems() : appState.scheduledItems);
}

function refreshPreviewUi(): void {
  setSchedulerPreviewMode(previewSession.active);
  setSchedulerReadOnly(isSchedulingUiLocked());
  renderChatPreviewActions(previewSession.active);
  renderSchedulerFromCurrentState();
  refreshIncomingRequests();
}

function setAiRequestPending(nextPending: boolean): void {
  aiRequestPending = nextPending;
  setSchedulerPreviewMode(previewSession.active);
  setSchedulerReadOnly(isSchedulingUiLocked());
  setIncomingRequestsDragDisabled(isSchedulingUiLocked());
  refreshIncomingRequests();
}

function emitSchedulerStateEvent(type: "preview_applied" | "preview_canceled"): void {
  const state = getPreviewAwareState(appState);
  const scheduledIds: SchedulerItemId[] = getItemIds(appState.scheduledItems);
  const unscheduledIds: SchedulerItemId[] = getItemIds(appState.unscheduledItems);

  socket.emit("scheduler_state_event", {
    type,
    state,
    scheduledIds,
    unscheduledIds,
  });
  console.info("[scheduler-preview] scheduler_state_event emitted", {
    type,
    previewActive: state.preview?.active,
    scheduledIds,
    unscheduledIds,
  });
}

initIncomingRequestsPanel(() => (
  previewSession.active
    ? buildUnscheduledPreviewItems()
    : getPlanningState(appState).unscheduledItems
));
initSchedulerBoard(appState.scheduledItems);
setSchedulerPreviewMode(false);
setSchedulerReadOnly(false);
setIncomingRequestsDragDisabled(false);
wireSchedulerDropTarget(refreshIncomingRequests, {
  isDisabled: isSchedulingUiLocked,
});
renderChatPreviewActions(false);

function applyCurrentPreview(): boolean {
  console.info("[scheduler-preview] applying preview draft", {
    draftScheduledIds: getItemIds(previewSession.draftState?.scheduledItems),
    draftUnscheduledIds: getItemIds(previewSession.draftState?.unscheduledItems),
    visiblePreviewItems: buildScheduledPreviewItems().map((item) => ({
      id: item.id,
      sourceId: item.preview_source_id ?? item.id,
      previewKind: item.preview_kind ?? "live",
    })),
  });

  if (applyPreviewToLive(appState)) {
    console.info("[scheduler-preview] preview applied", {
      liveScheduledIds: getItemIds(appState.scheduledItems),
      liveUnscheduledIds: getItemIds(appState.unscheduledItems),
    });
    refreshPreviewUi();
    emitSchedulerStateEvent("preview_applied");
    return true;
  }

  return false;
}

function cancelCurrentPreview(): boolean {
  if (cancelPreview()) {
    console.info("[scheduler-preview] preview canceled", {
      liveScheduledIds: getItemIds(appState.scheduledItems),
      liveUnscheduledIds: getItemIds(appState.unscheduledItems),
    });
    refreshPreviewUi();
    emitSchedulerStateEvent("preview_canceled");
    return true;
  }

  return false;
}

const mutatingPreviewCommands = new Set([
  "generate_schedule",
  "add_appointment",
  "update_appointments",
  "delete_appointments",
  "unschedule_appointments",
  "clear_all",
]);

const schedulerController = {
  replaceScheduledItems: (items: ScheduledItem[]) => {
    replaceScheduledItems(previewSession.active ? buildScheduledPreviewItems() : items);
  },
  setDate: setSchedulerDate,
  setSkin: setSchedulerSkin,
  setView: setSchedulerView,
  setZoom: setSchedulerZoom,
};

function createRunnerForState(state: SchedulerState) {
  return createCommandRunner({
    state,
    scheduler: schedulerController,
    renderIncomingRequests: refreshIncomingRequests,
  });
}

function commitTransactionState(target: SchedulerState, transactionState: SchedulerState): void {
  target.scheduledItems = transactionState.scheduledItems.map((item) => ({ ...item }));
  target.unscheduledItems = transactionState.unscheduledItems.map((item) => ({ ...item }));
  target.resources = transactionState.resources.map((resource) => ({ ...resource }));
}

function runCommand(cmd: string, params?: any) {
  if (cmd === "get_scheduler_state") {
    return {
      ok: true as const,
      cmd,
      data: getPreviewAwareState(appState),
    };
  }

  const isPreviewMutation = mutatingPreviewCommands.has(cmd);
  const startedPreview = isPreviewMutation && !previewSession.active;
  const state = isPreviewMutation
    ? startPreviewFromLive(appState)
    : getPlanningState(appState);
  const transactionState = isPreviewMutation ? cloneSchedulerState(state) : state;
  const beforeIds = summarizeStateIds(state);
  setSchedulerPreviewMode(previewSession.active);
  setSchedulerReadOnly(isSchedulingUiLocked());
  setIncomingRequestsDragDisabled(isSchedulingUiLocked());
  const runner = createRunnerForState(transactionState);
  let result;

  try {
    result = runner(cmd, params);
  } catch (error) {
    console.info("[scheduler-preview] mutation failed; state rolled back", {
      cmd,
      startedPreview,
      before: beforeIds,
      after: summarizeStateIds(state),
      unchanged: JSON.stringify(beforeIds) === JSON.stringify(summarizeStateIds(state)),
      error: error instanceof Error ? error.message : String(error),
    });

    if (startedPreview) {
      cancelPreview();
      refreshPreviewUi();
    }

    throw error;
  }

  if (isPreviewMutation) {
    commitTransactionState(state, transactionState);
    refreshPreviewUi();
  }

  if (isPreviewMutation) {
    console.info("[scheduler-preview] preview draft updated", {
      cmd,
      active: previewSession.active,
      liveScheduledIds: getItemIds(appState.scheduledItems),
      draftScheduledIds: getItemIds(previewSession.draftState?.scheduledItems),
      liveUnscheduledIds: getItemIds(appState.unscheduledItems),
      draftUnscheduledIds: getItemIds(previewSession.draftState?.unscheduledItems),
    });
  }

  if (cmd === "generate_schedule") {
    console.info("[scheduler-preview] generate_schedule draft state after success", {
      active: previewSession.active,
      draftScheduledIds: getItemIds(previewSession.draftState?.scheduledItems),
      draftUnscheduledIds: getItemIds(previewSession.draftState?.unscheduledItems),
      visiblePreviewItems: previewSession.active
        ? buildScheduledPreviewItems().map((item) => ({
            id: item.id,
            sourceId: item.preview_source_id ?? item.id,
            previewKind: item.preview_kind ?? "live",
          }))
        : [],
    });
  }

  return result;
}

Object.assign(window, { runSchedulerCommand: runCommand });

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";

const socket = io(SOCKET_URL);

initChat({
  socket,
  runCommand,
  getSchedulerState: () => getPreviewAwareState(appState),
  onApplyPreview: applyCurrentPreview,
  onCancelPreview: cancelCurrentPreview,
  onPendingChange: setAiRequestPending,
});
