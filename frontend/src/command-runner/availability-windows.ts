import type { AvailabilityResult, Resource, ScheduledItem } from "../scheduler/types.ts";
import {
  calculateExactWorkingMinutes,
  calculateLunchAwareEndDate,
  formatSchedulerDate,
  getDatePart,
  getElapsedMinutes,
  parseDateOnly,
  parseSchedulerDate,
  setMinutesOfDay,
  workEndMinutes,
  workStartMinutes,
} from "./date-utils.ts";

export type GetAvailabilityWindowsArgs = {
  date: string;
  estimated_minutes?: number;
  resource_ids?: string[];
  work_type?: string;
};

type AvailabilityState = {
  scheduledItems: ScheduledItem[];
  resources: Resource[];
};

export function buildAvailabilityWindows(
  state: AvailabilityState,
  args: GetAvailabilityWindowsArgs,
): AvailabilityResult {
  const date = parseDateOnly(args.date);

  if (Number.isNaN(date.getTime())) {
    throw new Error("get_availability_windows requires a valid YYYY-MM-DD date");
  }

  if (args.estimated_minutes != null && (!Number.isInteger(args.estimated_minutes) || args.estimated_minutes <= 0)) {
    throw new Error("get_availability_windows estimated_minutes must be a positive integer");
  }

  const selectedResourceIds = args.resource_ids?.length
    ? args.resource_ids
    : state.resources.map((resource) => resource.key);
  const resourcesById = new Map(state.resources.map((resource) => [resource.key, resource]));

  selectedResourceIds.forEach((resourceId) => {
    if (!resourcesById.has(resourceId)) {
      throw new Error(`Unknown resource_id: ${resourceId}`);
    }
  });

  const dayStart = setMinutesOfDay(date, workStartMinutes);
  const dayEnd = setMinutesOfDay(date, workEndMinutes);

  return {
    date: args.date,
    working_hours: {
      start: "09:00",
      end: "18:00",
    },
    lunch: {
      start: "12:00",
      end: "13:00",
      behavior: "pause_only_not_occupied",
    },
    resources: selectedResourceIds.map((resourceId) => {
      const resource = resourcesById.get(resourceId);
      const occupied = state.scheduledItems
        .filter((item) => item.resource_id === resourceId && getDatePart(item.start_date) === args.date)
        .map((item) => ({
          id: item.id,
          start_date: item.start_date,
          end_date: item.end_date,
          text: item.text,
        }))
        .sort((a, b) => parseSchedulerDate(a.start_date).getTime() - parseSchedulerDate(b.start_date).getTime());
      const boundaries = [
        dayStart,
        ...occupied.flatMap((item) => [
          parseSchedulerDate(item.start_date),
          parseSchedulerDate(item.end_date),
        ]),
        dayEnd,
      ];
      const windows = [];

      for (let index = 0; index < boundaries.length - 1; index += 2) {
        const startDate = boundaries[index];
        const endDate = boundaries[index + 1];

        if (endDate <= startDate) {
          continue;
        }

        const availableWorkingMinutes = calculateExactWorkingMinutes(startDate, endDate);
        const candidateEndDate = args.estimated_minutes == null
          ? undefined
          : calculateLunchAwareEndDate(startDate, args.estimated_minutes);

        windows.push({
          start_date: formatSchedulerDate(startDate),
          end_date: formatSchedulerDate(endDate),
          available_elapsed_minutes: getElapsedMinutes(startDate, endDate),
          available_working_minutes: availableWorkingMinutes,
          can_fit: candidateEndDate == null
            ? true
            : candidateEndDate <= endDate && candidateEndDate <= dayEnd,
          ...(candidateEndDate ? { candidate_end_date: formatSchedulerDate(candidateEndDate) } : {}),
        });
      }

      return {
        resource_id: resourceId,
        resource_label: resource?.label ?? resourceId,
        resource_description: resource?.description ?? "",
        occupied,
        windows,
      };
    }),
  };
}
