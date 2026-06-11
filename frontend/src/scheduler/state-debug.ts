import type { SchedulerItemId, SchedulerState } from "./types.ts";

type IdentifiedItem = {
  id: SchedulerItemId;
};

export type SchedulerStateIds = {
  scheduledIds: SchedulerItemId[];
  unscheduledIds: SchedulerItemId[];
};

export function getItemIds(items: IdentifiedItem[] | null | undefined): SchedulerItemId[] {
  return items?.map((item) => item.id) ?? [];
}

export function hasItemId(items: IdentifiedItem[], id: SchedulerItemId): boolean {
  return items.some((item) => String(item.id) === String(id));
}

export function formatIdList(ids: SchedulerItemId[], fallback = "none"): string {
  return ids.length ? ids.join(", ") : fallback;
}

export function summarizeStateIds(state: Pick<SchedulerState, "scheduledItems" | "unscheduledItems"> | null): SchedulerStateIds {
  return {
    scheduledIds: getItemIds(state?.scheduledItems),
    unscheduledIds: getItemIds(state?.unscheduledItems),
  };
}
