import type {
  CommandResult,
  Resource,
  ScheduledItem,
  SchedulerItemId,
  SchedulerState,
  UnscheduledItem,
} from "./scheduler/types.ts";
import { buildAvailabilityWindows, type GetAvailabilityWindowsArgs } from "./command-runner/availability-windows.ts";
import { normalizeGeneratedAppointmentEndDate, parseDateOnly } from "./command-runner/date-utils.ts";
import { createUnscheduledItemFromScheduledItem } from "./command-runner/item-transforms.ts";
import { ensureAppointment, ensureNoSameResourceOverlap, getIdsFromArgs } from "./command-runner/validation.ts";

type SchedulerController = {
  replaceScheduledItems: (items: ScheduledItem[]) => void;
  setDate: (date: Date) => void;
  setSkin: (skin: "material" | "flat" | "terrace" | "dark" | "contrast-white" | "contrast-black") => void;
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

type SetZoomArgs = {
  level: "day" | "3_days" | "week";
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
  | SetZoomArgs
  | GetAvailabilityWindowsArgs
  | Record<string, never>;

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
