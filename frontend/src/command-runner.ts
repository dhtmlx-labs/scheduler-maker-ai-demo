import type {
  CommandResult,
  Resource,
  ScheduledItem,
  SchedulerState,
  UnscheduledItem,
} from "./scheduler/types.ts";

type SchedulerController = {
  replaceScheduledItems: (items: ScheduledItem[]) => void;
  getScheduledItemsFromScheduler: () => ScheduledItem[];
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
  appointments: Array<Partial<ScheduledItem> & { id: number }>;
};

type DeleteAppointmentsArgs = {
  ids?: number[];
  appointments?: Array<{ id: number }>;
};

type GenerateScheduleArgs = {
  appointments?: ScheduledItem[];
  scheduledItems?: ScheduledItem[];
};

type ClearAllArgs = {
  includeUnscheduled?: boolean;
};

type CommandArgs =
  | AddAppointmentArgs
  | UpdateAppointmentsArgs
  | DeleteAppointmentsArgs
  | GenerateScheduleArgs
  | ClearAllArgs
  | Record<string, never>;

const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

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

function ensureDateString(value: string, field: string): void {
  if (!datePattern.test(value) || Number.isNaN(new Date(value.replace(" ", "T")).getTime())) {
    throw new Error(`Invalid ${field}: expected YYYY-MM-DD HH:mm`);
  }
}

function ensureAppointment(
  appointment: ScheduledItem,
  resources: Resource[],
): void {
  if (!Number.isFinite(appointment.id)) {
    throw new Error("Appointment id must be a number");
  }

  if (!appointment.text?.trim()) {
    throw new Error("Appointment text is required");
  }

  ensureResource(resources, appointment.resource_id);
  ensureDateString(appointment.start_date, "start_date");
  ensureDateString(appointment.end_date, "end_date");

  if (new Date(appointment.end_date.replace(" ", "T")) <= new Date(appointment.start_date.replace(" ", "T"))) {
    throw new Error("Appointment end_date must be after start_date");
  }
}

function normalizeSchedulerItems(options: CommandRunnerOptions): ScheduledItem[] {
  return options.scheduler.getScheduledItemsFromScheduler().map((item) => ({ ...item }));
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
    options.state.scheduledItems = normalizeSchedulerItems(options);

    switch (cmd) {
      case "get_scheduler_state":
        return toResult(cmd, cloneState(options.state));

      case "add_appointment": {
        const appointment = args as AddAppointmentArgs;
        ensureAppointment(appointment, options.state.resources);

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
          options.state.scheduledItems[index] = next;
        });

        return toResult(cmd, syncScheduler(options));
      }

      case "delete_appointments": {
        const deleteArgs = args as DeleteAppointmentsArgs;
        const ids = deleteArgs.ids ?? deleteArgs.appointments?.map((appointment) => appointment.id);

        if (!Array.isArray(ids)) {
          throw new Error("delete_appointments requires ids or appointments");
        }

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

      case "generate_schedule": {
        const generateArgs = args as GenerateScheduleArgs;
        const appointments = generateArgs.appointments ?? generateArgs.scheduledItems;

        if (!Array.isArray(appointments)) {
          throw new Error("generate_schedule requires appointments or scheduledItems array");
        }

        appointments.forEach((appointment) => ensureAppointment(appointment, options.state.resources));
        const scheduledIds = new Set(appointments.map((appointment) => appointment.id));

        options.state.scheduledItems = appointments.map((appointment) => ({ ...appointment }));
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
