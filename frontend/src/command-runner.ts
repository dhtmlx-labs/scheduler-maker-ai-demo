import type {
  CommandResult,
  Resource,
  ScheduledItem,
  SchedulerItemId,
  SchedulerState,
  UnscheduledItem,
} from "./scheduler/types.ts";

type SchedulerController = {
  replaceScheduledItems: (items: ScheduledItem[]) => void;
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

type CommandArgs =
  | AddAppointmentArgs
  | UpdateAppointmentsArgs
  | DeleteAppointmentsArgs
  | UnscheduleAppointmentsArgs
  | GenerateScheduleArgs
  | ClearAllArgs
  | Record<string, never>;

const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const workStartMinutes = 9 * 60;
const lunchStartMinutes = 12 * 60;
const lunchEndMinutes = 13 * 60;
const workEndMinutes = 18 * 60;

function cloneState(state: SchedulerAppState): SchedulerState {
  return {
    scheduledItems: state.scheduledItems.map((item) => ({ ...item })),
    unscheduledItems: state.unscheduledItems.map((item) => ({ ...item })),
    resources: state.resources.map((resource) => ({ ...resource })),
  };
}

function ensureResource(resources: Resource[], resourceId: string): void {
  if (!resources.some((resource) => resource.key === resourceId)) {
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
  const startMinutes = getMinutesOfDay(startDate);
  const endMinutes = getMinutesOfDay(endDate);
  const lunchOverlapMinutes = Math.max(
    0,
    Math.min(endMinutes, lunchEndMinutes) - Math.max(startMinutes, lunchStartMinutes),
  );

  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000) - lunchOverlapMinutes);
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

  ensureResource(resources, appointment.resource_id);
  ensureDateString(appointment.start_date, "start_date");
  ensureDateString(appointment.end_date, "end_date");

  const startDate = parseSchedulerDate(appointment.start_date);
  const endDate = parseSchedulerDate(appointment.end_date);

  if (endDate <= startDate) {
    throw new Error("Appointment end_date must be after start_date");
  }

  if (startDate.toDateString() !== endDate.toDateString()) {
    throw new Error("Appointment must start and end on the same day");
  }

  const startMinutes = getMinutesOfDay(startDate);
  const endMinutes = getMinutesOfDay(endDate);

  if (startMinutes < workStartMinutes || endMinutes > workEndMinutes) {
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
  const overlaps = scheduledItems.some((item) => {
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

  if (overlaps) {
    throw new Error(`Appointment overlaps an existing work order for resource_id: ${appointment.resource_id}`);
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

      case "add_appointment": {
        const appointment = args as AddAppointmentArgs;
        ensureAppointment(appointment, options.state.resources);
        ensureNoSameResourceOverlap(appointment, options.state.scheduledItems);

        if (options.state.scheduledItems.some((item) => item.id === appointment.id)) {
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
            throw new Error(`Unknown appointment id: ${id}`);
          }

          if (options.state.unscheduledItems.some((unscheduledItem) => unscheduledItem.id === id)) {
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
              throw new Error(`generate_schedule cannot reuse existing scheduled appointment id: ${appointment.id}`);
            }

            if (!pendingUnscheduledIds.has(appointment.id)) {
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
        nextScheduledItems.forEach((appointment) => {
          ensureNoSameResourceOverlap(
            appointment,
            nextScheduledItems,
            { ignoreId: appointment.id },
          );
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

      default:
        throw new Error(`Unknown Scheduler command: ${cmd}`);
    }
  };
}
