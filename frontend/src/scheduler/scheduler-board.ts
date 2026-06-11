import "@dhx/trial-scheduler/codebase/dhtmlxscheduler.css";

import { scheduler } from "@dhx/trial-scheduler";

import { appState } from "../app-state.ts";
import { formatSchedulerDate } from "./scheduler-utils.ts";
import { getResourceCapabilityIcons } from "./work-type-icons.ts";

import type { Resource, ScheduledItem, SchedulerItemId } from "./types.ts";
import { demoDate, resources, seedScheduledItems } from "./data.ts";
import type { ScheduledPreviewItem } from "../preview/preview-session.ts";

import "./scheduler.css";

export type SchedulerZoomLevel = "day" | "3_days" | "week";
export type SchedulerSkin = "material" | "flat" | "terrace" | "dark" | "contrast-white" | "contrast-black";

const allowedSkins = new Set<SchedulerSkin>([
  "material",
  "flat",
  "terrace",
  "dark",
  "contrast-white",
  "contrast-black",
]);

let currentSkin: SchedulerSkin = "terrace";
let schedulerPreviewMode = false;
let schedulerAiPendingMode = false;
let replacingScheduledItems = false;

const zoomConfigs: Record<SchedulerZoomLevel, {
  x_unit: "hour" | "day";
  x_date: string;
  x_step: number;
  x_size: number;
  x_start: number;
  x_length: number;
}> = {
  day: {
    x_unit: "hour",
    x_date: "%H:%i",
    x_step: 1,
    x_size: 11,
    x_start: 8,
    x_length: 24,
  },
  "3_days": {
    x_unit: "hour",
    x_date: "%D %j<br>%H:%i",
    x_step: 1,
    x_size: 72,
    x_start: 0,
    x_length: 72,
  },
  week: {
    x_unit: "day",
    x_date: "%D %j",
    x_step: 1,
    x_size: 7,
    x_start: 0,
    x_length: 7,
  },
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPreviewLabel(event: ScheduledPreviewItem): string {
  switch (event.preview_kind) {
    case "existing":
      return "Existing";
    case "proposed_new":
      return "Proposed";
    case "old_position":
      return "Old time";
    case "proposed_moved":
      return "New time";
    case "proposed_deleted":
      return "Removing";
    default:
      return "";
  }
}

function appointmentClass(event: ScheduledPreviewItem): string {
  return [
    "service-event",
    `service-event--${event.status}`,
    event.priority === "urgent" ? "service-event--urgent" : "",
    event.preview_kind ? "service-event--preview" : "",
    event.preview_kind ? `service-event--preview-${event.preview_kind}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeSchedulerEvent(event: any, fallbackId?: SchedulerItemId): ScheduledItem {
  return {
    id: event.id ?? fallbackId ?? "",
    text: event.text ?? "",
    start_date: event.start_date instanceof Date ? formatSchedulerDate(event.start_date) : event.start_date,
    end_date: event.end_date instanceof Date ? formatSchedulerDate(event.end_date) : event.end_date,
    resource_id: event.resource_id,
    status: event.status ?? "scheduled",
    priority: event.priority ?? "normal",
    requester: event.requester ?? "",
    location: event.location ?? "",
    asset: event.asset ?? "",
    issue: event.issue ?? "",
    work_type: event.work_type ?? "",
  };
}

function upsertScheduledItem(item: ScheduledItem): void {
  const index = appState.scheduledItems.findIndex((scheduledItem) => scheduledItem.id === item.id);

  if (index === -1) {
    appState.scheduledItems.push(item);
    return;
  }

  appState.scheduledItems[index] = item;
}

function removeScheduledItem(id: SchedulerItemId): void {
  appState.scheduledItems = appState.scheduledItems.filter((item) => item.id !== id);
}

function configureScheduler(): void {
  scheduler.plugins({
    timeline: true,
    limit: true,
    tooltip: true,
    readonly: true,
  });

  scheduler.config.header = [
    "prev",
    "next",
    "date",
    "spacer",
  ];

  scheduler.config.date_format = "%Y-%m-%d %H:%i";

  scheduler.createTimelineView({
    name: "timeline",
    ...zoomConfigs.day,
    y_unit: resources,
    y_property: "resource_id",
    render: "bar",
    event_dy: "full",
    section_autoheight: true,
  });

  scheduler.templates.event_class = (_start, _end, event: ScheduledPreviewItem) => appointmentClass(event);

  scheduler.templates.event_bar_text = (_start, _end, event: ScheduledPreviewItem) => `
    <div class="service-event__title">${escapeHtml(event.asset)}</div>
    <div class="service-event__meta">${escapeHtml(event.location)}</div>
    ${event.preview_kind ? `<div class="service-event__preview-label">${escapeHtml(getPreviewLabel(event))}</div>` : ""}
  `;

  scheduler.templates.tooltip_text = (_start, _end, event: ScheduledPreviewItem) => `
    <div class="service-tooltip">
      ${event.preview_kind ? `<strong>${escapeHtml(getPreviewLabel(event))}</strong><br />` : ""}
      <strong>${escapeHtml(event.requester)}</strong><br />
      ${escapeHtml(event.asset)}<br />
      <span>${escapeHtml(event.issue)}</span><br />
      <em>${escapeHtml(event.work_type)} - ${escapeHtml(event.priority)} priority</em>
    </div>
  `;

  scheduler.templates.timeline_scale_label = (_key, _label, section: Resource) => `
    <div class="resource-label">
      <strong>${escapeHtml(section.name)}</strong>
      <span class="resource-label__specialization">
        <span class="resource-label__icons" aria-hidden="true">${getResourceCapabilityIcons(section.description).map(escapeHtml).join(" ")}</span>
        ${escapeHtml(section.description)}
      </span>
    </div>
  `;

  scheduler.templates.timeline_cell_class = (_events, date) => {
    const timeline = scheduler.getView("timeline");
    const day = date.getDay();

    if (timeline?.x_unit === "day") {
      return day === 0 || day === 6 ? "non_working_time" : "";
    }

    const hour = date.getHours();

    if (hour < 9 || hour >= 18) {
      return "non_working_time";
    }

    if (hour === 12) {
      return "lunch_time";
    }

    return "";
  };
}

function configureDataProcessor(): void {
  scheduler.createDataProcessor((_entity: string, action: string, data: any, id: string | number) => {
    if (schedulerPreviewMode || schedulerAiPendingMode || replacingScheduledItems) {
      console.info("[scheduler-lock] ignored Scheduler DataProcessor write", {
        action,
        id,
        preview: schedulerPreviewMode,
        aiPending: schedulerAiPendingMode,
        replacing: replacingScheduledItems,
      });

      return Promise.resolve({ action: "updated", tid: data?.id ?? id });
    }

    if (action === "delete") {
      removeScheduledItem(id);
      return Promise.resolve({ action: "deleted", tid: id });
    }

    if (action === "create" || action === "update") {
      upsertScheduledItem(normalizeSchedulerEvent(data, id));
      return Promise.resolve({ tid: data.id ?? id });
    }

    return Promise.resolve({ action: "updated", tid: id });
  });
}

export function initSchedulerBoard(scheduledItems: ScheduledItem[] = seedScheduledItems): void {
  configureScheduler();

  scheduler.init("scheduler_here", demoDate, "timeline");
  scheduler.setSkin(currentSkin);
  configureDataProcessor();
  replaceScheduledItems(scheduledItems);
}

export function replaceScheduledItems(scheduledItems: ScheduledItem[]): void {
  replacingScheduledItems = true;

  try {
    scheduler.clearAll();
    scheduler.parse(scheduledItems.map((item) => ({ ...item })));
  } finally {
    replacingScheduledItems = false;
  }
}

export function getScheduledItemsFromScheduler(): ScheduledItem[] {
  return scheduler.getEvents().map((event) => normalizeSchedulerEvent(event));
}

export function setSchedulerDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid Scheduler date");
  }

  scheduler.setCurrentView(date, scheduler.getState().mode);
}

export function setSchedulerSkin(skin: SchedulerSkin): void {
  if (!allowedSkins.has(skin)) {
    throw new Error(`Unsupported Scheduler skin: ${skin}`);
  }

  currentSkin = skin;
  scheduler.setSkin(skin);
}

export function setSchedulerZoom(level: SchedulerZoomLevel): void {
  const config = zoomConfigs[level];

  if (!config) {
    throw new Error(`Unsupported Scheduler zoom: ${level}`);
  }

  Object.assign(scheduler.matrix.timeline, config);
  scheduler.setCurrentView(scheduler.getState().date, "timeline");
}

export function setSchedulerPreviewMode(active: boolean): void {
  schedulerPreviewMode = active;
  schedulerAiPendingMode = false;
  scheduler.config.readonly = active;
}

export function setSchedulerReadOnly(active: boolean): void {
  schedulerAiPendingMode = active && !schedulerPreviewMode;
  scheduler.config.readonly = active;
}

export function getDropTarget(event: DragEvent): { startDate: Date; resourceId: string } | null {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const slot = target.closest(".dhx_scale_time_slot, .dhx_timeline_data_cell, .dhx_matrix_cell");

  if (!slot) {
    return null;
  }

  const actionData = scheduler.getActionData(event);

  if (!actionData?.date || !actionData?.section) {
    return null;
  }

  return {
    startDate: actionData.date,
    resourceId: String(actionData.section),
  };
}
