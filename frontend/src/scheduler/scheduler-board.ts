import "@dhx/trial-scheduler/codebase/dhtmlxscheduler.css";

import { scheduler } from "@dhx/trial-scheduler";

import { formatSchedulerDate } from "./scheduler-utils.ts";

import type { Resource, ScheduledItem } from "./types.ts";
import { resources, seedScheduledItems } from "./data.ts";

import "./scheduler.css";

const demoDate = new Date(2026, 5, 5);

function escapeHtml(value: string): string {
  return value
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
    <div class="service-event__title">${escapeHtml(event.requester)} - ${escapeHtml(event.asset)}</div>
    <div class="service-event__meta">${escapeHtml(event.work_type)} | ${escapeHtml(event.status.replace("_", " "))}</div>
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

  scheduler.templates.timeline_cell_class = (_events, date, _section) => {
    const hour = date.getHours();

    if (hour < 9 || hour === 12 || hour >= 18) {
      return "non_working_time";
    }

    return "";
  };
}

export function initSchedulerBoard(scheduledItems: ScheduledItem[] = seedScheduledItems): void {
  configureScheduler();

  scheduler.init("scheduler_here", demoDate, "timeline");
  replaceScheduledItems(scheduledItems);
}

export function replaceScheduledItems(scheduledItems: ScheduledItem[]): void {
  scheduler.clearAll();
  scheduler.parse(scheduledItems);
}

export function getScheduledItemsFromScheduler(): ScheduledItem[] {
  return scheduler.getEvents().map((event) => ({
    id: Number(event.id),
    text: event.text,
    start_date: event.start_date instanceof Date ? formatSchedulerDate(event.start_date) : event.start_date,
    end_date: event.end_date instanceof Date ? formatSchedulerDate(event.end_date) : event.end_date,
    resource_id: event.resource_id,
    status: event.status,
    priority: event.priority,
    requester: event.requester,
    location: event.location,
    asset: event.asset,
    issue: event.issue,
    work_type: event.work_type,
  }));
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
