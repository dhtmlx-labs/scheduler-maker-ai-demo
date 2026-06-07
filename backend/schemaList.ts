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
  "Appointment date/time in Scheduler format YYYY-MM-DD HH:mm. Use the current date from the system prompt unless the user asks for another date. Use working hours 09:00-18:00. Lunch 12:00-13:00 pauses work and must not count toward estimated working duration.",
);

const resourceIdSchema = z.string().min(1).describe(
  "Scheduler Timeline resource id. For this demo use alex, nina, marek, or sofia.",
);

const appointmentStatusSchema = z.enum([
  "scheduled",
  "in_progress",
  "waiting_parts",
  "ready",
]).describe("Current scheduled item status.");

const prioritySchema = z.enum(["normal", "urgent"]).describe("Request priority.");

function parseSchedulerDate(value: string): Date {
  return new Date(value.replace(" ", "T"));
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

const scheduledItemObjectSchema = z.object({
  id: schedulerItemIdSchema,
  text: z.string().min(1).describe("Short appointment title shown in Scheduler."),
  start_date: dateTimeSchema,
  end_date: dateTimeSchema,
  resource_id: resourceIdSchema,
  status: appointmentStatusSchema,
  priority: prioritySchema,
  requester: z.string().min(1).describe("Person or account requesting the work."),
  location: z.string().min(1).describe("Service bay, intake area, or other work location."),
  asset: z.string().min(1).describe("Vehicle, equipment, or other serviced asset."),
  issue: z.string().min(1).describe("Problem or request details."),
  work_type: z.string().min(1).describe("Type of work, such as EV diagnostic or brake inspection."),
}).strict();

export const scheduledItemSchema = scheduledItemObjectSchema.superRefine((item, context) => {
  const start = parseSchedulerDate(item.start_date);
  const end = parseSchedulerDate(item.end_date);
  const startMinutes = minutesOfDay(start);
  const endMinutes = minutesOfDay(end);

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
      message: "appointments must start and end on the same day",
    });
  }

  if (startMinutes < 9 * 60 || endMinutes > 18 * 60) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["start_date"],
      message: "appointments must stay within working hours 09:00-18:00",
    });
  }
});

export const unscheduledItemSchema = z.object({
  id: schedulerItemIdSchema,
  text: z.string().min(1).describe("Short incoming request title."),
  estimated_minutes: z.number().int().positive().describe("Estimated working duration in minutes. Lunch 12:00-13:00 does not count toward this duration."),
  requester: z.string().min(1).describe("Person or account requesting the work."),
  location: z.string().optional().describe("Optional intake location or preferred work area."),
  asset: z.string().min(1).describe("Vehicle, equipment, or other serviced asset."),
  issue: z.string().optional().describe("Problem or request details."),
  work_type: z.string().min(1).describe("Type of work requested."),
  priority: prioritySchema,
}).strict();

const generateScheduleSchema = z.object({
  unscheduledItems: z.array(unscheduledItemSchema).optional().describe(
    "Pending incoming requests without assigned resource/time. Use these as the source items when the user asks to schedule pending requests. They must not include resource_id, start_date, or end_date.",
  ),
  appointments: z.array(scheduledItemObjectSchema).min(1).describe(
    "New scheduled appointments created from pending incoming requests. For pending-request scheduling, include ONLY newly generated appointments, never existing scheduled appointments. Each appointment id MUST equal the source unscheduled incoming request id. Calculate end_date from the request estimated_minutes; lunch 12:00-13:00 pauses work, so an appointment may span lunch and must be extended by lunch time.",
  ),
  allowLunchOverlap: z.boolean().optional().describe(
    "Compatibility option. Lunch is treated as paused non-working time by default, so this is usually unnecessary.",
  ),
  replaceExisting: z.boolean().optional().describe(
    "Default false. Set true only when the user explicitly asks to replace the entire existing schedule. For normal pending-request scheduling, omit this or set false so existing appointments remain unchanged.",
  ),
}).strict().superRefine((value, context) => {
  value.appointments.forEach((item, index) => {
    const start = parseSchedulerDate(item.start_date);
    const end = parseSchedulerDate(item.end_date);
    const startMinutes = minutesOfDay(start);
    const endMinutes = minutesOfDay(end);

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
        message: "appointments must start and end on the same day",
      });
    }

    if (startMinutes < 9 * 60 || endMinutes > 18 * 60) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appointments", index, "start_date"],
        message: "appointments must stay within working hours 09:00-18:00",
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
  ).min(1).describe("Existing appointments to update. Include id and only fields that should change."),
}).strict();

const deleteAppointmentsSchema = z.object({
  ids: z.array(schedulerItemIdSchema).min(1).describe("Scheduled appointment ids to delete."),
}).strict();

const clearAllSchema = z.object({
  includeUnscheduled: z.boolean().optional().describe(
    "When true, also clear incoming unscheduled requests. Defaults to false.",
  ),
}).strict();

const getSchedulerStateSchema = z.object({}).strict();

const setViewSchema = z.object({
  view: z.enum(["timeline", "day", "week"]).describe("Scheduler view to activate."),
}).strict();

const setSkinSchema = z.object({
  skin: z.string().min(1).describe("DHTMLX Scheduler skin name."),
}).strict();

const setZoomSchema = z.object({
  level: z.enum(["compact", "normal", "detailed"]).describe("Timeline zoom density."),
}).strict();

export const toolSchemasByName = {
  generate_schedule: generateScheduleSchema,
  add_appointment: addAppointmentSchema,
  update_appointments: updateAppointmentsSchema,
  delete_appointments: deleteAppointmentsSchema,
  clear_all: clearAllSchema,
  get_scheduler_state: getSchedulerStateSchema,
  set_view: setViewSchema,
  set_skin: setSkinSchema,
  set_zoom: setZoomSchema,
} as const;

export type ToolName = keyof typeof toolSchemasByName;
export type ToolArgumentsByName = {
  [Name in ToolName]: z.infer<(typeof toolSchemasByName)[Name]>;
};

const toolDescriptions: Record<ToolName, string> = {
  generate_schedule:
    "Schedule pending incoming requests into the existing Scheduler day. For normal pending-request scheduling, generate appointments only from unscheduledItems, preserve each incoming request id, do not include existing scheduled appointments, and do not replace the existing schedule unless replaceExisting is explicitly true.",
  add_appointment:
    "Create one scheduled appointment with assigned resource and start/end time.",
  update_appointments:
    "Update one or more existing scheduled appointments by id.",
  delete_appointments:
    "Delete one or more scheduled appointments by id.",
  clear_all:
    "Clear scheduled appointments, optionally also clearing incoming unscheduled requests.",
  get_scheduler_state:
    "Return the current Scheduler state, including scheduled appointments, incoming requests, and resources.",
  set_view:
    "Change the Scheduler view.",
  set_skin:
    "Change the DHTMLX Scheduler skin.",
  set_zoom:
    "Change the Scheduler Timeline zoom density.",
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
