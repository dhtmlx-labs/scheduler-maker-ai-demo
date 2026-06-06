import type { UnscheduledItem } from "./scheduler/types.ts";

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return `${rest} min`;
  }

  if (rest === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${rest} min`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRequestCard(item: UnscheduledItem): string {
  return `
    <article class="incoming-card" draggable="true" data-request-id="${item.id}">
      <div class="incoming-card__header">
        <span class="incoming-card__priority incoming-card__priority--${item.priority}">
          ${escapeHtml(item.priority)}
        </span>
        <span class="incoming-card__duration">${formatDuration(item.estimated_minutes)}</span>
      </div>
      <h3>${escapeHtml(item.text)}</h3>
      <p>${escapeHtml(item.requester)} - ${escapeHtml(item.asset)}</p>
      <dl>
        <div>
          <dt>Work</dt>
          <dd>${escapeHtml(item.work_type)}</dd>
        </div>
        <div>
          <dt>Issue</dt>
          <dd>${escapeHtml(item.issue)}</dd>
        </div>
      </dl>
    </article>
  `;
}

export function initIncomingRequestsPanel(items: UnscheduledItem[]): void {
  const list = document.querySelector<HTMLElement>("#incoming_requests_list");
  const count = document.querySelector<HTMLElement>("#incoming_requests_count");

  if (!list) {
    return;
  }

  list.innerHTML = items.map(renderRequestCard).join("");

  if (count) {
    count.textContent = `${items.length} waiting`;
  }
}
