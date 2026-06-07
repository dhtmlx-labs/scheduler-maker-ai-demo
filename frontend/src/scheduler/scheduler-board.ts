import "@dhx/trial-scheduler/codebase/dhtmlxscheduler.css";

import { scheduler } from "@dhx/trial-scheduler";

import { appState } from "../app-state.ts";
import { formatSchedulerDate } from "./scheduler-utils.ts";

import type { Resource, ScheduledItem, SchedulerItemId } from "./types.ts";
import { demoDate, resources, seedScheduledItems } from "./data.ts";

import "./scheduler.css";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appointmentClass(event: ScheduledItem): string {
  return [
    "service-event",
    `service-event--${event.status}`,
    event.priority === "urgent" ? "service-event--urgent" : "",
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
  });

  scheduler.config.header = [
    "prev",
    "next",
    "date",
    "spacer",
  ];

  scheduler.config.date_format = "%Y-%m-%d %H:%i";
  // scheduler.templates.parse_date

  scheduler.createTimelineView({
    name: "timeline",
    x_unit: "hour",
    x_date: "%H:%i",
    x_step: 1,
    x_size: 11,
    x_start: 8,
    y_unit: resources,
    y_property: "resource_id",
    render: "bar",
    event_dy: "full",
    section_autoheight: true,
  });

  scheduler.templates.event_class = (_start, _end, event: ScheduledItem) => appointmentClass(event);

  scheduler.templates.event_bar_text = (_start, _end, event: ScheduledItem) => `
    <div class="service-event__title">${escapeHtml(event.asset)}</div>
    <div class="service-event__meta">${escapeHtml(event.location)}</div>
  `;

  scheduler.templates.tooltip_text = (_start, _end, event: ScheduledItem) => `
    <div class="service-tooltip">
      <strong>${escapeHtml(event.requester)}</strong><br />
      ${escapeHtml(event.asset)}<br />
      <span>${escapeHtml(event.issue)}</span><br />
      <em>${escapeHtml(event.work_type)} - ${escapeHtml(event.priority)} priority</em>
    </div>
  `;

  scheduler.templates.timeline_scale_label = (_key, _label, section: Resource) => `
    <div class="resource-label">
      <strong>${escapeHtml(section.name)}</strong>
      <span>${escapeHtml(section.description)}</span>
    </div>
  `;

  scheduler.templates.timeline_cell_class = (_events, date) => {
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
  configureDataProcessor();
  replaceScheduledItems(scheduledItems);
}

export function replaceScheduledItems(scheduledItems: ScheduledItem[]): void {
  scheduler.clearAll();
  scheduler.parse(scheduledItems.map((item) => ({ ...item })));
}

export function getScheduledItemsFromScheduler(): ScheduledItem[] {
  return scheduler.getEvents().map((event) => normalizeSchedulerEvent(event));
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
