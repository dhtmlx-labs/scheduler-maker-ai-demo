import type { Resource, ScheduledItem, SchedulerItemId } from "../scheduler/types.ts";
import {
  ensureDateString,
  getMinutesOfDay,
  parseSchedulerDate,
  workEndMinutes,
  workStartMinutes,
} from "./date-utils.ts";

type IdArgs = {
  ids?: SchedulerItemId[];
  appointments?: Array<{ id: SchedulerItemId }>;
};

export function ensureResource(resources: Resource[], resourceId: string, appointment?: ScheduledItem): void {
  if (!resources.some((resource) => resource.key === resourceId)) {
    console.warn("[scheduler-diagnostics] validation failed: unknown resource_id", {
      resourceId,
      allowedResourceIds: resources.map((resource) => resource.key),
      appointment,
    });
    throw new Error(`Unknown resource_id: ${resourceId}`);
  }
}

export function ensureAppointment(
  appointment: ScheduledItem,
  resources: Resource[],
): void {
  if (typeof appointment.id !== "string" && typeof appointment.id !== "number") {
    throw new Error("Appointment id must be a string or number");
  }

  if (String(appointment.id).trim() === "") {
    throw new Error("Appointment id is required");
  }

  if (!appointment.text?.trim()) {
    throw new Error("Appointment text is required");
  }

  ensureResource(resources, appointment.resource_id, appointment);

  try {
    ensureDateString(appointment.start_date, "start_date");
  } catch (error) {
    console.warn("[scheduler-diagnostics] validation failed: invalid start_date", {
      appointment,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  try {
    ensureDateString(appointment.end_date, "end_date");
  } catch (error) {
    console.warn("[scheduler-diagnostics] validation failed: invalid end_date", {
      appointment,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const startDate = parseSchedulerDate(appointment.start_date);
  const endDate = parseSchedulerDate(appointment.end_date);

  if (endDate <= startDate) {
    console.warn("[scheduler-diagnostics] validation failed: end before start", {
      appointment,
      startDate,
      endDate,
    });
    throw new Error("Appointment end_date must be after start_date");
  }

  if (startDate.toDateString() !== endDate.toDateString()) {
    console.warn("[scheduler-diagnostics] validation failed: cross-day appointment", {
      appointment,
      startDate,
      endDate,
    });
    throw new Error("Appointment must start and end on the same day");
  }

  const startMinutes = getMinutesOfDay(startDate);
  const endMinutes = getMinutesOfDay(endDate);

  if (startMinutes < workStartMinutes || endMinutes > workEndMinutes) {
    console.warn("[scheduler-diagnostics] validation failed: outside working hours", {
      appointment,
      startMinutes,
      endMinutes,
      workingHours: {
        start: workStartMinutes,
        end: workEndMinutes,
      },
    });
    throw new Error("Appointment must stay within working hours 09:00-18:00");
  }
}

export function ensureNoSameResourceOverlap(
  appointment: ScheduledItem,
  scheduledItems: ScheduledItem[],
  options: { ignoreId?: SchedulerItemId } = {},
): void {
  const startDate = parseSchedulerDate(appointment.start_date);
  const endDate = parseSchedulerDate(appointment.end_date);
  const overlappingItems = scheduledItems.filter((item) => {
    if (options.ignoreId != null && item.id === options.ignoreId) {
      return false;
    }

    if (item.resource_id !== appointment.resource_id) {
      return false;
    }

    const itemStartDate = parseSchedulerDate(item.start_date);
    const itemEndDate = parseSchedulerDate(item.end_date);

    return startDate < itemEndDate && endDate > itemStartDate;
  });

  if (overlappingItems.length) {
    const conflicts = overlappingItems.map((item) => ({
      id: item.id,
      resource_id: item.resource_id,
      start_date: item.start_date,
      end_date: item.end_date,
    }));
    const attempted = {
      id: appointment.id,
      resource_id: appointment.resource_id,
      start_date: appointment.start_date,
      end_date: appointment.end_date,
    };

    console.warn("[scheduler-diagnostics] validation failed: same-resource overlap", {
      appointment,
      overlappingItems,
      ignoreId: options.ignoreId,
    });
    throw new Error([
      `Appointment overlaps an existing work order for resource_id: ${appointment.resource_id}.`,
      `Attempted appointment: ${JSON.stringify(attempted)}.`,
      `Conflicting appointments: ${JSON.stringify(conflicts)}.`,
      "Choose a different interval for the same resource or choose another resource after checking existing scheduledItems.",
    ].join(" "));
  }
}

export function getIdsFromArgs(
  args: IdArgs,
  commandName: string,
): SchedulerItemId[] {
  const ids = args.ids ?? args.appointments?.map((appointment) => appointment.id);

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(`${commandName} requires ids or appointments`);
  }

  return ids;
}
