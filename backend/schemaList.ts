import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const schedulerItemIdSchema = z.union([z.string().min(1), z.number()]).describe(
  "DHTMLX Scheduler event id. Scheduler ids can be strings or numbers.",
);

const dateTimeSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
  "Use YYYY-MM-DD HH:mm",
).describe(
  "Appointment date/time in Scheduler format YYYY-MM-DD HH:mm. Never leave this empty. Use the current date from the system prompt unless the user asks for another date. Use working hours 09:00-18:00. Lunch 12:00-13:00 pauses work and must not count toward estimated working duration. If the exact start_date or end_date is not known, call get_availability_windows again before calling a scheduling mutation tool.",
);

const resourceIdSchema = z.string().min(1).describe(
  "Scheduler Timeline resource id. Must exactly match the canonical resource identifier from the current get_scheduler_state resources list; for current resource objects use resources[].key. Do not invent placeholder ids.",
);

const appointmentStatusSchema = z.enum([
  "scheduled",
  "in_progress",
  "waiting_parts",
  "ready",
]).describe("Current scheduled item status.");

const prioritySchema = z.enum(["normal", "urgent"]).describe("Request priority.");

function parseSchedulerDate(value: string): Date {
  const match = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.exec(value);

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

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

const scheduledItemObjectSchema = z.object({
  id: schedulerItemIdSchema,
  text: z.string().min(1).describe("Short maintenance work order title shown in Scheduler."),
  start_date: dateTimeSchema,
  end_date: dateTimeSchema,
  resource_id: resourceIdSchema,
  status: appointmentStatusSchema,
  priority: prioritySchema,
  requester: z.string().min(1).describe("Tenant, employee, facility manager, or other person requesting the work."),
  location: z.string().min(1).describe("Floor, room, lobby, mechanical room, parking level, or other building location."),
  asset: z.string().min(1).describe("Room, floor, equipment, HVAC unit, elevator, access system, lighting circuit, or other maintained asset."),
  issue: z.string().min(1).describe("Maintenance problem or request details."),
  work_type: z.string().min(1).describe("Type of maintenance work, such as HVAC, electrical, plumbing, access control, cleaning, inspection, or repair."),
}).strict();

export const scheduledItemSchema = scheduledItemObjectSchema.superRefine((item, context) => {
  const start = parseSchedulerDate(item.start_date);
  const end = parseSchedulerDate(item.end_date);
  const startMinutes = minutesOfDay(start);
  const endMinutes = minutesOfDay(end);

  if (Number.isNaN(start.getTime())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["start_date"],
      message: "start_date must be a real calendar date/time",
    });
  }

  if (Number.isNaN(end.getTime())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_date"],
      message: "end_date must be a real calendar date/time",
    });
  }

  if (end <= start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_date"],
      message: "end_date must be after start_date",
    });
  }

  if (start.toDateString() !== end.toDateString()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_date"],
      message: "work orders must start and end on the same day",
    });
  }

  if (startMinutes < 9 * 60 || endMinutes > 18 * 60) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["start_date"],
      message: "work orders must stay within working hours 09:00-18:00",
    });
  }
});

export const unscheduledItemSchema = z.object({
  id: schedulerItemIdSchema,
  text: z.string().min(1).describe("Short incoming maintenance request title."),
  estimated_minutes: z.number().int().positive().describe("Estimated working duration in minutes. Lunch 12:00-13:00 does not count toward this duration."),
  requester: z.string().min(1).describe("Tenant, employee, facility manager, or other person requesting the work."),
  location: z.string().optional().describe("Floor, room, lobby, mechanical room, parking level, or other building location."),
  asset: z.string().min(1).describe("Room, floor, equipment, HVAC unit, elevator, access system, lighting circuit, or other maintained asset."),
  issue: z.string().optional().describe("Maintenance problem or request details."),
  work_type: z.string().min(1).describe("Type of maintenance work requested."),
  priority: prioritySchema,
}).strict();

const generateScheduleSchema = z.object({
  unscheduledItems: z.array(unscheduledItemSchema).optional().describe(
    "Pending incoming maintenance requests without assigned resource/time. Use these as the source items when the user asks to schedule pending requests. They must not include resource_id, start_date, or end_date. When the user asks for urgent incoming requests, the requested set is all unscheduledItems where priority is urgent unless the user explicitly asks otherwise.",
  ),
  appointments: z.array(scheduledItemObjectSchema).min(1).describe(
    "New scheduled maintenance work orders created from pending incoming maintenance requests. For pending-request scheduling, include ONLY newly generated appointments, never existing scheduledItems. Each appointment id MUST equal the source unscheduled incoming request id. Never call generate_schedule with empty start_date or end_date. If exact dates are not known, call get_availability_windows again first. If the user asked for urgent incoming requests, include every urgent unscheduled item that has a same-day non-overlapping placement preserving existing scheduled work orders; do not omit one just to ask whether to include it. Before choosing start_date/end_date, check existing scheduledItems for the same resource_id and use only a free interval that does not overlap any same-resource appointment. Calculate end_date from the request estimated_minutes; lunch 12:00-13:00 pauses work and is not an occupied appointment, so a work order may span lunch and must be extended by lunch time.",
  ),
  allowLunchOverlap: z.boolean().optional().describe(
    "Compatibility option. Lunch is treated as paused non-working time by default, so this is usually unnecessary.",
  ),
  replaceExisting: z.boolean().optional().describe(
    "Default false. Set true only when the user explicitly asks to replace the entire existing schedule. For normal pending-request scheduling, omit this or set false so existing work orders remain unchanged.",
  ),
}).strict().superRefine((value, context) => {
  value.appointments.forEach((item, index) => {
    const start = parseSchedulerDate(item.start_date);
    const end = parseSchedulerDate(item.end_date);
    const startMinutes = minutesOfDay(start);
    const endMinutes = minutesOfDay(end);

    if (Number.isNaN(start.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appointments", index, "start_date"],
        message: "start_date must be a real calendar date/time",
      });
    }

    if (Number.isNaN(end.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appointments", index, "end_date"],
        message: "end_date must be a real calendar date/time",
      });
    }

    if (end <= start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appointments", index, "end_date"],
        message: "end_date must be after start_date",
      });
    }

    if (start.toDateString() !== end.toDateString()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appointments", index, "end_date"],
        message: "work orders must start and end on the same day",
      });
    }

    if (startMinutes < 9 * 60 || endMinutes > 18 * 60) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appointments", index, "start_date"],
        message: "work orders must stay within working hours 09:00-18:00",
      });
    }
  });
});

const addAppointmentSchema = scheduledItemSchema;

const updateAppointmentsSchema = z.object({
  appointments: z.array(
    scheduledItemObjectSchema.partial().extend({
      id: schedulerItemIdSchema,
    }).strict(),
  ).min(1).describe("Existing scheduled work orders to update. Include id and only fields that should change."),
}).strict();

const deleteAppointmentsSchema = z.object({
  ids: z.array(schedulerItemIdSchema).min(1).optional().describe("Scheduled work order ids to delete."),
  appointments: z.array(z.object({
    id: schedulerItemIdSchema,
  }).strict()).min(1).optional().describe("Alternative delete payload when the model has appointment objects with ids."),
}).strict().refine((value) => Array.isArray(value.ids) || Array.isArray(value.appointments), {
  message: "delete_appointments requires ids or appointments",
});

const unscheduleAppointmentsSchema = z.object({
  ids: z.array(schedulerItemIdSchema).min(1).optional().describe(
    "Scheduled work order ids to move back into Incoming Requests.",
  ),
  appointments: z.array(z.object({
    id: schedulerItemIdSchema,
  }).strict()).min(1).optional().describe(
    "Alternative unschedule payload when the model has appointment objects with ids.",
  ),
}).strict().refine((value) => Array.isArray(value.ids) || Array.isArray(value.appointments), {
  message: "unschedule_appointments requires ids or appointments",
});

const clearAllSchema = z.object({
  includeUnscheduled: z.boolean().optional().describe(
    "When true, also clear incoming unscheduled requests. Defaults to false.",
  ),
}).strict();

const getSchedulerStateSchema = z.object({}).strict();

const getAvailabilityWindowsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").describe(
    "Date to inspect in YYYY-MM-DD format.",
  ),
  estimated_minutes: z.number().int().positive().optional().describe(
    "Optional working duration to test against available windows. Lunch 12:00-13:00 does not count toward this duration.",
  ),
  resource_ids: z.array(resourceIdSchema).min(1).optional().describe(
    "Optional resource ids to inspect. If omitted, inspect all current resources. Each id must come from get_scheduler_state.resources[].key.",
  ),
  work_type: z.string().min(1).optional().describe(
    "Optional requested work type for context only. This tool does not choose or filter the final resource automatically.",
  ),
}).strict();

const setSkinSchema = z.object({
  skin: z.enum([
    "material",
    "flat",
    "terrace",
    "dark",
    "contrast-white",
    "contrast-black",
  ]).describe("Allowed DHTMLX Scheduler skin name."),
}).strict();

const setZoomSchema = z.object({
  level: z.enum(["day", "3_days", "week"]).describe(
    "Timeline zoom range. day shows one day with hourly scale, 3_days shows three days with hourly scale, week shows seven day columns.",
  ),
}).strict();

const setDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").describe(
    "Scheduler date to display in YYYY-MM-DD format.",
  ),
}).strict();

export const toolSchemasByName = {
  generate_schedule: generateScheduleSchema,
  add_appointment: addAppointmentSchema,
  update_appointments: updateAppointmentsSchema,
  delete_appointments: deleteAppointmentsSchema,
  clear_all: clearAllSchema,
  get_scheduler_state: getSchedulerStateSchema,
  get_availability_windows: getAvailabilityWindowsSchema,
  unschedule_appointments: unscheduleAppointmentsSchema,
  set_skin: setSkinSchema,
  set_zoom: setZoomSchema,
  set_date: setDateSchema,
} as const;

export type ToolName = keyof typeof toolSchemasByName;
export type ToolArgumentsByName = {
  [Name in ToolName]: z.infer<(typeof toolSchemasByName)[Name]>;
};

const toolDescriptions: Record<ToolName, string> = {
  generate_schedule:
    "Prepare a preview schedule for pending incoming maintenance requests. For normal pending-request scheduling, generate work orders only from unscheduledItems, preserve each incoming request id, use resource_id values that exactly match current get_scheduler_state resources identifiers, check same-resource existing appointments before placement, do not include existing scheduledItems, and do not replace the existing schedule unless replaceExisting is explicitly true. If the user asks for urgent incoming requests, prepare all urgent unscheduled items that can fit without moving/replacing existing work orders.",
  add_appointment:
    "Prepare a preview containing one scheduled maintenance work order with assigned resource and start/end time. resource_id must match the current get_scheduler_state resources identifier.",
  update_appointments:
    "Prepare a preview update for one or more existing scheduled maintenance work orders by id.",
  delete_appointments:
    "Prepare a preview deletion for one or more scheduled maintenance work orders by id.",
  clear_all:
    "Prepare a preview that clears scheduled maintenance work orders, optionally also clearing incoming unscheduled requests.",
  get_scheduler_state:
    "Return the current Scheduler state, including scheduled maintenance work orders, incoming requests, and resources.",
  get_availability_windows:
    "Return read-only availability facts for a date: occupied intervals, available windows, lunch pause behavior, and optional fit/candidate end time for an estimated duration. This is diagnostic support only; it does not choose a final resource, create appointments, start previews, or mutate state.",
  unschedule_appointments:
    "Prepare a preview that moves one or more scheduled maintenance work orders back into Incoming Requests by id. Use this when the user asks to unschedule, unassign, or move a work order back to the request queue.",
  set_skin:
    "Change the DHTMLX Scheduler skin.",
  set_zoom:
    "Change the Scheduler Timeline zoom range without modifying scheduled or incoming items.",
  set_date:
    "Jump the Scheduler to a specific date without modifying scheduled or incoming items.",
};

function toToolDefinition(name: ToolName): ChatCompletionTool {
  const parameters = zodToJsonSchema(toolSchemasByName[name], {
    $refStrategy: "none",
  });

  return {
    type: "function",
    function: {
      name,
      description: toolDescriptions[name],
      parameters,
    },
  };
}

// Zod keeps tool definitions, TypeScript argument types, and runtime validators
// in one place. This avoids the drift-prone handwritten JSON schema approach
// used by the Gantt demo and lets helper.ts validate the same shapes it exposes
// to OpenAI.
export const schemaList: ChatCompletionTool[] = (Object.keys(toolSchemasByName) as ToolName[])
  .map(toToolDefinition);
