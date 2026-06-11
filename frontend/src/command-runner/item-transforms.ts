import type { ScheduledItem, UnscheduledItem } from "../scheduler/types.ts";
import { calculateWorkingMinutes, parseSchedulerDate } from "./date-utils.ts";

export function createUnscheduledItemFromScheduledItem(item: ScheduledItem): UnscheduledItem {
  const startDate = parseSchedulerDate(item.start_date);
  const endDate = parseSchedulerDate(item.end_date);

  return {
    id: item.id,
    text: item.text,
    requester: item.requester,
    location: item.location,
    asset: item.asset,
    issue: item.issue,
    work_type: item.work_type,
    priority: item.priority,
    estimated_minutes: calculateWorkingMinutes(startDate, endDate),
  };
}
