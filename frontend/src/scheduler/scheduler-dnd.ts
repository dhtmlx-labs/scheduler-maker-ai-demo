import { appState } from "../app-state.ts";
import {
  getDropTarget,
  replaceScheduledItems,
} from "./scheduler-board.ts";

import type { UnscheduledItem } from "./types.ts";
import { createScheduledItemFromRequest } from "./scheduler-utils.ts";

export function wireSchedulerDropTarget(renderIncomingRequests: () => void): void {
  const schedulerElement = document.querySelector<HTMLElement>("#scheduler_here");

  if (!schedulerElement) {
    return;
  }

  schedulerElement.addEventListener("dragover", (event) => {
    if (!getDropTarget(event)) {
      return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  });

  schedulerElement.addEventListener("drop", (event) => {
    const target = getDropTarget(event);
    const json = event.dataTransfer?.getData("application/json");

    if (!target || !json) {
      return;
    }

    event.preventDefault();

    const draggedItem = JSON.parse(json) as UnscheduledItem;
    const item = appState.unscheduledItems.find((request) => request.id === draggedItem.id);

    if (!item) {
      return;
    }

    const scheduledItem = createScheduledItemFromRequest(item, target.startDate, target.resourceId);

    appState.scheduledItems.push(scheduledItem);
    appState.unscheduledItems = appState.unscheduledItems.filter((request) => request.id !== item.id);

    replaceScheduledItems(appState.scheduledItems);
    renderIncomingRequests();
  });
}
