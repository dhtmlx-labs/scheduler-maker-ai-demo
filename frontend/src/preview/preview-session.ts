import type { ScheduledItem, SchedulerItemId, SchedulerState, UnscheduledItem } from "../scheduler/types.ts";

export type PreviewSessionState = {
  active: boolean;
  baseState: SchedulerState | null;
  draftState: SchedulerState | null;
};

export type ScheduledPreviewKind =
  | "existing"
  | "proposed_new"
  | "old_position"
  | "proposed_moved"
  | "proposed_deleted";

export type UnscheduledPreviewKind =
  | "existing"
  | "proposed_new"
  | "proposed_removed";

export type ScheduledPreviewItem = ScheduledItem & {
  preview_kind?: ScheduledPreviewKind;
  preview_source_id?: SchedulerItemId;
};

export type UnscheduledPreviewItem = UnscheduledItem & {
  preview_kind?: UnscheduledPreviewKind;
  preview_source_id?: SchedulerItemId;
};

export const previewSession: PreviewSessionState = {
  active: false,
  baseState: null,
  draftState: null,
};

export function cloneSchedulerState(state: SchedulerState): SchedulerState {
  return {
    scheduledItems: state.scheduledItems.map((item) => ({ ...item })),
    unscheduledItems: state.unscheduledItems.map((item) => ({ ...item })),
    resources: state.resources.map((resource) => ({ ...resource })),
  };
}

export function startPreviewFromLive(liveState: SchedulerState): SchedulerState {
  if (!previewSession.active || !previewSession.draftState) {
    previewSession.active = true;
    previewSession.baseState = cloneSchedulerState(liveState);
    previewSession.draftState = cloneSchedulerState(liveState);
  }

  return previewSession.draftState;
}

export function applyPreviewToLive(liveState: SchedulerState): boolean {
  if (!previewSession.active || !previewSession.draftState) {
    return false;
  }

  liveState.scheduledItems = previewSession.draftState.scheduledItems.map((item) => ({ ...item }));
  liveState.unscheduledItems = previewSession.draftState.unscheduledItems.map((item) => ({ ...item }));
  previewSession.active = false;
  previewSession.baseState = null;
  previewSession.draftState = null;

  return true;
}

export function cancelPreview(): boolean {
  if (!previewSession.active) {
    return false;
  }

  previewSession.active = false;
  previewSession.baseState = null;
  previewSession.draftState = null;

  return true;
}

export function getPlanningState(liveState: SchedulerState): SchedulerState {
  return previewSession.active && previewSession.draftState
    ? previewSession.draftState
    : liveState;
}

export function getPreviewAwareState(liveState: SchedulerState): SchedulerState {
  const state = cloneSchedulerState(getPlanningState(liveState));

  return {
    ...state,
    preview: {
      active: previewSession.active,
      liveStateUnchanged: previewSession.active,
    },
  };
}

function indexById<T extends { id: SchedulerItemId }>(items: T[]): Map<SchedulerItemId, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function hasSchedulePositionChanged(baseItem: ScheduledItem, draftItem: ScheduledItem): boolean {
  return baseItem.start_date !== draftItem.start_date ||
    baseItem.end_date !== draftItem.end_date ||
    baseItem.resource_id !== draftItem.resource_id;
}

function hasScheduledItemChanged(baseItem: ScheduledItem, draftItem: ScheduledItem): boolean {
  return hasSchedulePositionChanged(baseItem, draftItem) ||
    baseItem.text !== draftItem.text ||
    baseItem.status !== draftItem.status ||
    baseItem.priority !== draftItem.priority ||
    baseItem.requester !== draftItem.requester ||
    baseItem.location !== draftItem.location ||
    baseItem.asset !== draftItem.asset ||
    baseItem.issue !== draftItem.issue ||
    baseItem.work_type !== draftItem.work_type;
}

function previewId(kind: ScheduledPreviewKind, id: SchedulerItemId): string {
  return `preview:${kind}:${String(id)}`;
}

export function buildScheduledPreviewItems(): ScheduledPreviewItem[] {
  if (!previewSession.active || !previewSession.baseState || !previewSession.draftState) {
    return [];
  }

  const baseById = indexById(previewSession.baseState.scheduledItems);
  const draftById = indexById(previewSession.draftState.scheduledItems);
  const previewItems: ScheduledPreviewItem[] = [];

  previewSession.baseState.scheduledItems.forEach((baseItem) => {
    const draftItem = draftById.get(baseItem.id);

    if (!draftItem) {
      previewItems.push({
        ...baseItem,
        id: previewId("proposed_deleted", baseItem.id),
        preview_kind: "proposed_deleted",
        preview_source_id: baseItem.id,
      });
      return;
    }

    if (hasSchedulePositionChanged(baseItem, draftItem)) {
      previewItems.push({
        ...baseItem,
        id: previewId("old_position", baseItem.id),
        preview_kind: "old_position",
        preview_source_id: baseItem.id,
      });
      previewItems.push({
        ...draftItem,
        preview_kind: "proposed_moved",
        preview_source_id: draftItem.id,
      });
      return;
    }

    previewItems.push({
      ...draftItem,
      preview_kind: hasScheduledItemChanged(baseItem, draftItem) ? "proposed_moved" : "existing",
      preview_source_id: draftItem.id,
    });
  });

  previewSession.draftState.scheduledItems.forEach((draftItem) => {
    if (baseById.has(draftItem.id)) {
      return;
    }

    previewItems.push({
      ...draftItem,
      preview_kind: "proposed_new",
      preview_source_id: draftItem.id,
    });
  });

  return previewItems;
}

export function buildUnscheduledPreviewItems(): UnscheduledPreviewItem[] {
  if (!previewSession.active || !previewSession.baseState || !previewSession.draftState) {
    return [];
  }

  const baseById = indexById(previewSession.baseState.unscheduledItems);
  const draftById = indexById(previewSession.draftState.unscheduledItems);
  const previewItems: UnscheduledPreviewItem[] = [];

  previewSession.baseState.unscheduledItems.forEach((baseItem) => {
    const draftItem = draftById.get(baseItem.id);

    if (!draftItem) {
      previewItems.push({
        ...baseItem,
        preview_kind: "proposed_removed",
        preview_source_id: baseItem.id,
      });
      return;
    }

    previewItems.push({
      ...draftItem,
      preview_kind: "existing",
      preview_source_id: draftItem.id,
    });
  });

  previewSession.draftState.unscheduledItems.forEach((draftItem) => {
    if (baseById.has(draftItem.id)) {
      return;
    }

    previewItems.push({
      ...draftItem,
      preview_kind: "proposed_new",
      preview_source_id: draftItem.id,
    });
  });

  return previewItems;
}
