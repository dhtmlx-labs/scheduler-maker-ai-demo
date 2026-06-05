import "@dhx/trial-scheduler/codebase/dhtmlxscheduler.css";

import { scheduler } from "@dhx/trial-scheduler";

import { seedScheduledItems, resources } from "./data.ts";
import type { Resource, ScheduledItem } from "./types.ts";

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

  scheduler.templates.event_class = (_start, _end, event: ScheduledItem) => appointmentClass(event);

  scheduler.templates.event_text = (_start, _end, event: ScheduledItem) => `
    <div class="service-event__title">${escapeHtml(event.requester)} - ${escapeHtml(event.asset)}</div>
    <div class="service-event__meta">${escapeHtml(event.work_type)} | ${escapeHtml(event.status.replace("_", " "))}</div>
  `;

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

  scheduler.templates.timeline_scale_label = (_key, _label, section: Resource) => `
    <div class="Resource-label">
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

export function initSchedulerBoard(): void {
  configureScheduler();

  scheduler.init("scheduler_here", demoDate, "timeline");
  scheduler.parse(seedScheduledItems);
}
