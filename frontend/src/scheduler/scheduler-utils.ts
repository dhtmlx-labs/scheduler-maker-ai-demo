import { scheduler } from "@dhx/trial-scheduler";
import type { ScheduledItem, UnscheduledItem } from "./types.ts";

const dateToString = scheduler.date.date_to_str("%Y-%m-%d %H:%i");

export function addMinutes(date: Date, minutes: number): Date {
  return scheduler.date.add(date, minutes, "minute");
}

export function formatSchedulerDate(date: Date): string {
  return dateToString(date);
}

export function createScheduledItemFromRequest(
  item: UnscheduledItem,
  startDate: Date,
  resourceId: string,
): ScheduledItem {
  const endDate = addMinutes(startDate, item.estimated_minutes);

  return {
    id: item.id,
    text: item.text,
    start_date: formatSchedulerDate(startDate),
    end_date: formatSchedulerDate(endDate),
    resource_id: resourceId,
    status: "scheduled",
    priority: item.priority,
    requester: item.requester,
    location: item.location,
    asset: item.asset,
    issue: item.issue,
    work_type: item.work_type,
  };
}
