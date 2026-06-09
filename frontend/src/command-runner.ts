import type {
  AvailabilityResult,
  CommandResult,
  Resource,
  ScheduledItem,
  SchedulerItemId,
  SchedulerState,
  UnscheduledItem,
} from "./scheduler/types.ts";

type SchedulerController = {
  replaceScheduledItems: (items: ScheduledItem[]) => void;
  setDate: (date: Date) => void;
  setSkin: (skin: "material" | "flat" | "terrace" | "dark" | "contrast-white" | "contrast-black") => void;
  setView: (view: "timeline" | "day" | "week") => void;
  setZoom: (level: "day" | "3_days" | "week") => void;
};

type SchedulerAppState = {
  scheduledItems: ScheduledItem[];
  unscheduledItems: UnscheduledItem[];
  resources: Resource[];
};

type CommandRunnerOptions = {
  state: SchedulerAppState;
  scheduler: SchedulerController;
  renderIncomingRequests: () => void;
};

type AddAppointmentArgs = ScheduledItem;

type UpdateAppointmentsArgs = {
  appointments: Array<Partial<ScheduledItem> & { id: SchedulerItemId }>;
};

type DeleteAppointmentsArgs = {
  ids?: SchedulerItemId[];
  appointments?: Array<{ id: SchedulerItemId }>;
};

type UnscheduleAppointmentsArgs = {
  ids?: SchedulerItemId[];
  appointments?: Array<{ id: SchedulerItemId }>;
};

type GenerateScheduleArgs = {
  appointments?: ScheduledItem[];
  scheduledItems?: ScheduledItem[];
  unscheduledItems?: UnscheduledItem[];
  allowLunchOverlap?: boolean;
  replaceExisting?: boolean;
};

type ClearAllArgs = {
  includeUnscheduled?: boolean;
};

type SetDateArgs = {
  date: string;
};

type SetSkinArgs = {
  skin: "material" | "flat" | "terrace" | "dark" | "contrast-white" | "contrast-black";
};

type SetViewArgs = {
  view: "timeline" | "day" | "week";
};

type SetZoomArgs = {
  level: "day" | "3_days" | "week";
};

type GetAvailabilityWindowsArgs = {
  date: string;
  estimated_minutes?: number;
  resource_ids?: string[];
  work_type?: string;
};

type CommandArgs =
  | AddAppointmentArgs
  | UpdateAppointmentsArgs
  | DeleteAppointmentsArgs
  | UnscheduleAppointmentsArgs
  | GenerateScheduleArgs
  | ClearAllArgs
  | SetDateArgs
  | SetSkinArgs
  | SetViewArgs
  | SetZoomArgs
  | GetAvailabilityWindowsArgs
  | Record<string, never>;

const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const workStartMinutes = 9 * 60;
const lunchStartMinutes = 12 * 60;
const lunchEndMinutes = 13 * 60;
const workEndMinutes = 18 * 60;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

function cloneState(state: SchedulerAppState): SchedulerState {
  return {
    scheduledItems: state.scheduledItems.map((item) => ({ ...item })),
    unscheduledItems: state.unscheduledItems.map((item) => ({ ...item })),
    resources: state.resources.map((resource) => ({ ...resource })),
  };
}

function summarizeState(state: SchedulerAppState): Record<string, unknown> {
  return {
    scheduledItems: state.scheduledItems.map((item) => ({
      id: item.id,
      resource_id: item.resource_id,
      start_date: item.start_date,
      end_date: item.end_date,
      text: item.text,
    })),
    unscheduledItems: state.unscheduledItems.map((item) => ({
      id: item.id,
      priority: item.priority,
      estimated_minutes: item.estimated_minutes,
      text: item.text,
      work_type: item.work_type,
    })),
    resources: state.resources.map((resource) => ({
      key: resource.key,
      name: resource.name,
      description: resource.description,
    })),
  };
}

function ensureResource(resources: Resource[], resourceId: string, appointment?: ScheduledItem): void {
  if (!resources.some((resource) => resource.key === resourceId)) {
    console.warn("[scheduler-diagnostics] validation failed: unknown resource_id", {
      resourceId,
      allowedResourceIds: resources.map((resource) => resource.key),
      appointment,
    });
    throw new Error(`Unknown resource_id: ${resourceId}`);
  }
}

function parseSchedulerDate(value: string): Date {
  const match = datePattern.exec(value);

  if (!match) {
    return new Date(Number.NaN);
  }

  const [datePart, timePart] = value.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes] = timePart.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  ) {
    return new Date(Number.NaN);
  }

  return date;
}

function ensureDateString(value: string, field: string): void {
  if (!datePattern.test(value) || Number.isNaN(parseSchedulerDate(value).getTime())) {
    throw new Error(`Invalid ${field}: expected YYYY-MM-DD HH:mm`);
  }
}

function parseDateOnly(value: string): Date {
  if (!dateOnlyPattern.test(value)) {
    return new Date(Number.NaN);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return new Date(Number.NaN);
  }

  return date;
}

function getMinutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatSchedulerDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function setMinutesOfDay(date: Date, minutesOfDay: number): Date {
  const next = new Date(date);
  next.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
  return next;
}

function calculateLunchAwareEndDate(startDate: Date, workingMinutes: number): Date {
  let cursor = new Date(startDate);
  let remainingMinutes = workingMinutes;

  while (remainingMinutes > 0) {
    const minutes = getMinutesOfDay(cursor);

    if (minutes >= lunchStartMinutes && minutes < lunchEndMinutes) {
      cursor = setMinutesOfDay(cursor, lunchEndMinutes);
      continue;
    }

    const nextPauseMinutes = minutes < lunchStartMinutes ? lunchStartMinutes : workEndMinutes;
    const availableMinutes = nextPauseMinutes - getMinutesOfDay(cursor);

    if (availableMinutes <= 0) {
      return addMinutes(cursor, remainingMinutes);
    }

    const stepMinutes = Math.min(remainingMinutes, availableMinutes);
    cursor = addMinutes(cursor, stepMinutes);
    remainingMinutes -= stepMinutes;
  }

  return cursor;
}

function normalizeGeneratedAppointmentEndDate(
  appointment: ScheduledItem,
  unscheduledItem: UnscheduledItem,
): ScheduledItem {
  const startDate = parseSchedulerDate(appointment.start_date);
  const endDate = calculateLunchAwareEndDate(startDate, unscheduledItem.estimated_minutes);

  return {
    ...appointment,
    end_date: formatSchedulerDate(endDate),
  };
}

function calculateWorkingMinutes(startDate: Date, endDate: Date): number {
  return Math.max(1, calculateExactWorkingMinutes(startDate, endDate));
}

function calculateExactWorkingMinutes(startDate: Date, endDate: Date): number {
  const startMinutes = getMinutesOfDay(startDate);
  const endMinutes = getMinutesOfDay(endDate);
  const lunchOverlapMinutes = Math.max(
    0,
    Math.min(endMinutes, lunchEndMinutes) - Math.max(startMinutes, lunchStartMinutes),
  );

  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000) - lunchOverlapMinutes);
}

function getElapsedMinutes(startDate: Date, endDate: Date): number {
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
}

function getDatePart(value: string): string {
  return value.split(" ")[0] ?? "";
}

function buildAvailabilityWindows(
  state: SchedulerAppState,
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

function ensureAppointment(
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

function ensureNoSameResourceOverlap(
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

function getIdsFromArgs(
  args: DeleteAppointmentsArgs | UnscheduleAppointmentsArgs,
  commandName: string,
): SchedulerItemId[] {
  const ids = args.ids ?? args.appointments?.map((appointment) => appointment.id);

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(`${commandName} requires ids or appointments`);
  }

  return ids;
}

function createUnscheduledItemFromScheduledItem(item: ScheduledItem): UnscheduledItem {
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

function syncScheduler(options: CommandRunnerOptions): SchedulerState {
  options.scheduler.replaceScheduledItems(options.state.scheduledItems);
  options.renderIncomingRequests();

  return cloneState(options.state);
}

function toResult<T>(cmd: string, data: T): CommandResult<T> {
  return {
    ok: true,
    cmd,
    data,
  };
}

export function createCommandRunner(options: CommandRunnerOptions) {
  return function runCommand(cmd: string, args: CommandArgs = {}): CommandResult {
    console.info("[scheduler-tool]", cmd, args);

    switch (cmd) {
      case "get_scheduler_state":
        return toResult(cmd, cloneState(options.state));

      case "get_availability_windows":
        return toResult(cmd, buildAvailabilityWindows(options.state, args as GetAvailabilityWindowsArgs));

      case "add_appointment": {
        const appointment = args as AddAppointmentArgs;
        ensureAppointment(appointment, options.state.resources);
        ensureNoSameResourceOverlap(appointment, options.state.scheduledItems);

        if (options.state.scheduledItems.some((item) => item.id === appointment.id)) {
          console.warn("[scheduler-diagnostics] validation failed: duplicate appointment id", {
            cmd,
            appointment,
            existingScheduledIds: options.state.scheduledItems.map((item) => item.id),
          });
          throw new Error(`Appointment already exists: ${appointment.id}`);
        }

        options.state.scheduledItems.push({ ...appointment });
        return toResult(cmd, syncScheduler(options));
      }

      case "update_appointments": {
        const { appointments } = args as UpdateAppointmentsArgs;

        if (!Array.isArray(appointments)) {
          throw new Error("update_appointments requires appointments array");
        }

        appointments.forEach((patch) => {
          const index = options.state.scheduledItems.findIndex((item) => item.id === patch.id);

          if (index === -1) {
            console.warn("[scheduler-diagnostics] validation failed: update unknown appointment id", {
              cmd,
              patch,
              existingScheduledIds: options.state.scheduledItems.map((item) => item.id),
            });
            throw new Error(`Unknown appointment id: ${patch.id}`);
          }

          const next = {
            ...options.state.scheduledItems[index],
            ...patch,
          };

          ensureAppointment(next, options.state.resources);
          ensureNoSameResourceOverlap(next, options.state.scheduledItems, { ignoreId: patch.id });
          options.state.scheduledItems[index] = next;
        });

        return toResult(cmd, syncScheduler(options));
      }

      case "delete_appointments": {
        const deleteArgs = args as DeleteAppointmentsArgs;
        const ids = getIdsFromArgs(deleteArgs, "delete_appointments");

        ids.forEach((id) => {
          if (!options.state.scheduledItems.some((item) => item.id === id)) {
            console.warn("[scheduler-diagnostics] validation failed: delete unknown appointment id", {
              cmd,
              id,
              existingScheduledIds: options.state.scheduledItems.map((item) => item.id),
            });
            throw new Error(`Unknown appointment id: ${id}`);
          }
        });

        options.state.scheduledItems = options.state.scheduledItems.filter(
          (item) => !ids.includes(item.id),
        );

        return toResult(cmd, syncScheduler(options));
      }

      case "unschedule_appointments": {
        const unscheduleArgs = args as UnscheduleAppointmentsArgs;
        const ids = getIdsFromArgs(unscheduleArgs, "unschedule_appointments");
        const idsToUnschedule = new Set(ids);
        const restoredItems = ids.map((id) => {
          const item = options.state.scheduledItems.find((scheduledItem) => scheduledItem.id === id);

          if (!item) {
            console.warn("[scheduler-diagnostics] validation failed: unschedule unknown appointment id", {
              cmd,
              id,
              existingScheduledIds: options.state.scheduledItems.map((scheduledItem) => scheduledItem.id),
            });
            throw new Error(`Unknown appointment id: ${id}`);
          }

          if (options.state.unscheduledItems.some((unscheduledItem) => unscheduledItem.id === id)) {
            console.warn("[scheduler-diagnostics] validation failed: incoming request already exists", {
              cmd,
              id,
              existingUnscheduledIds: options.state.unscheduledItems.map((unscheduledItem) => unscheduledItem.id),
            });
            throw new Error(`Incoming request already exists for appointment id: ${id}`);
          }

          return createUnscheduledItemFromScheduledItem(item);
        });

        options.state.scheduledItems = options.state.scheduledItems.filter(
          (item) => !idsToUnschedule.has(item.id),
        );
        options.state.unscheduledItems = [
          ...options.state.unscheduledItems.map((item) => ({ ...item })),
          ...restoredItems,
        ];

        return toResult(cmd, syncScheduler(options));
      }

      case "generate_schedule": {
        const generateArgs = args as GenerateScheduleArgs;
        const appointments = generateArgs.appointments ?? generateArgs.scheduledItems;
        const replaceExisting = generateArgs.replaceExisting === true;

        if (!Array.isArray(appointments)) {
          throw new Error("generate_schedule requires appointments or scheduledItems array");
        }

        const existingScheduledIds = new Set(options.state.scheduledItems.map((item) => item.id));
        const pendingUnscheduledById = new Map(
          options.state.unscheduledItems.map((item) => [item.id, item]),
        );
        const stateBefore = summarizeState(options.state);

        console.info("[scheduler-diagnostics] generate_schedule received", {
          replaceExisting,
          appointmentIds: appointments.map((appointment) => appointment.id),
          appointmentResources: appointments.map((appointment) => ({
            id: appointment.id,
            resource_id: appointment.resource_id,
            start_date: appointment.start_date,
            end_date: appointment.end_date,
          })),
          existingScheduledIds: Array.from(existingScheduledIds),
          pendingIncomingIds: Array.from(pendingUnscheduledById.keys()),
          stateBefore,
        });

        const normalizedAppointments = appointments.map((appointment) => {
          if (replaceExisting) {
            return appointment;
          }

          const unscheduledItem = pendingUnscheduledById.get(appointment.id);

          if (!unscheduledItem) {
            return appointment;
          }

          return normalizeGeneratedAppointmentEndDate(appointment, unscheduledItem);
        });
        const generatedIds = normalizedAppointments.map((appointment) => appointment.id);
        const scheduledIds = new Set(generatedIds);
        const pendingUnscheduledIds = new Set(options.state.unscheduledItems.map((item) => item.id));

        if (!replaceExisting) {
          normalizedAppointments.forEach((appointment) => {
            if (existingScheduledIds.has(appointment.id)) {
              console.warn("[scheduler-diagnostics] validation failed: generate_schedule reused scheduled id", {
                appointment,
                existingScheduledIds: Array.from(existingScheduledIds),
                pendingIncomingIds: Array.from(pendingUnscheduledIds),
                stateBefore,
              });
              throw new Error(`generate_schedule cannot reuse existing scheduled appointment id: ${appointment.id}`);
            }

            if (!pendingUnscheduledIds.has(appointment.id)) {
              console.warn("[scheduler-diagnostics] validation failed: generate_schedule id is not pending", {
                appointment,
                existingScheduledIds: Array.from(existingScheduledIds),
                pendingIncomingIds: Array.from(pendingUnscheduledIds),
                stateBefore,
              });
              throw new Error(`generate_schedule appointment id must match a pending incoming request id: ${appointment.id}`);
            }
          });
        }

        const nextScheduledItems = replaceExisting
          ? normalizedAppointments
          : [
              ...options.state.scheduledItems,
              ...normalizedAppointments,
            ];

        normalizedAppointments.forEach((appointment) => ensureAppointment(appointment, options.state.resources));

        const scheduledItemsForValidation = replaceExisting
          ? []
          : options.state.scheduledItems.map((appointment) => ({ ...appointment }));

        normalizedAppointments.forEach((appointment) => {
          ensureNoSameResourceOverlap(appointment, scheduledItemsForValidation);
          scheduledItemsForValidation.push(appointment);
        });

        const removedUnscheduledIds = options.state.unscheduledItems
          .filter((item) => scheduledIds.has(item.id))
          .map((item) => item.id);

        console.info("[scheduler-tool] generate_schedule appointment ids", generatedIds);
        console.info("[scheduler-tool] generate_schedule normalized appointments", normalizedAppointments);
        console.info("[scheduler-tool] generate_schedule removed unscheduled ids", removedUnscheduledIds);

        options.state.scheduledItems = nextScheduledItems.map((appointment) => ({ ...appointment }));
        options.state.unscheduledItems = options.state.unscheduledItems.filter(
          (item) => !scheduledIds.has(item.id),
        );

        console.info("[scheduler-diagnostics] generate_schedule success state", {
          generatedIds,
          removedUnscheduledIds,
          stateAfter: summarizeState(options.state),
        });

        return toResult(cmd, syncScheduler(options));
      }

      case "clear_all": {
        const clearArgs = args as ClearAllArgs;

        options.state.scheduledItems = [];

        if (clearArgs.includeUnscheduled) {
          options.state.unscheduledItems = [];
        }

        return toResult(cmd, syncScheduler(options));
      }

      case "set_date": {
        const { date } = args as SetDateArgs;
        const nextDate = parseDateOnly(date);

        if (Number.isNaN(nextDate.getTime())) {
          throw new Error("set_date requires a valid YYYY-MM-DD date");
        }

        options.scheduler.setDate(nextDate);
        return toResult(cmd, cloneState(options.state));
      }

      case "set_skin": {
        const { skin } = args as SetSkinArgs;
        options.scheduler.setSkin(skin);
        return toResult(cmd, cloneState(options.state));
      }

      case "set_view": {
        const { view } = args as SetViewArgs;
        options.scheduler.setView(view);
        return toResult(cmd, cloneState(options.state));
      }

      case "set_zoom": {
        const { level } = args as SetZoomArgs;
        options.scheduler.setZoom(level);
        return toResult(cmd, cloneState(options.state));
      }

      default:
        throw new Error(`Unknown Scheduler command: ${cmd}`);
    }
  };
}
