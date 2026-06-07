import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const schedulerItemIdSchema = z.union([z.string().min(1), z.number()]).describe(
  "DHTMLX Scheduler event id. Scheduler ids can be strings or numbers.",
);

const dateTimeSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
  "Use YYYY-MM-DD HH:mm",
).describe("Appointment date/time in Scheduler format, for example 2026-06-05 09:30.");

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

export const scheduledItemSchema = z.object({
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

export const unscheduledItemSchema = z.object({
  id: schedulerItemIdSchema,
  text: z.string().min(1).describe("Short incoming request title."),
  estimated_minutes: z.number().int().positive().describe("Estimated duration in minutes."),
  requester: z.string().min(1).describe("Person or account requesting the work."),
  location: z.string().optional().describe("Optional intake location or preferred work area."),
  asset: z.string().min(1).describe("Vehicle, equipment, or other serviced asset."),
  issue: z.string().optional().describe("Problem or request details."),
  work_type: z.string().min(1).describe("Type of work requested."),
  priority: prioritySchema,
}).strict();

const generateScheduleSchema = z.object({
  unscheduledItems: z.array(unscheduledItemSchema).optional().describe(
    "Incoming requests without assigned resource/time. They must not include resource_id, start_date, or end_date.",
  ),
  appointments: z.array(scheduledItemSchema).min(1).describe(
    "Complete scheduled appointments to render in Scheduler.",
  ),
}).strict();

const addAppointmentSchema = scheduledItemSchema;

const updateAppointmentsSchema = z.object({
  appointments: z.array(
    scheduledItemSchema.partial().extend({
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
    "Generate or replace the visible Scheduler day from incoming unscheduled requests and scheduled appointments.",
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
