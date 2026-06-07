import "./incoming-requests.css";
import type { UnscheduledItem } from "../scheduler/types.ts";

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
    <article
      class="incoming-card"
      draggable="true"
      data-request-id="${item.id}"
      data-estimated-minutes="${item.estimated_minutes}"
    >
      <div class="incoming-card__top">
        <h3>${escapeHtml(item.text)}</h3>

        <div class="incoming-card__badges">
          <span class="incoming-card__priority incoming-card__priority--${item.priority}">
            ${escapeHtml(item.priority)}
          </span>

          <span class="incoming-card__duration">
            ${formatDuration(item.estimated_minutes)}
          </span>
        </div>
      </div>

      <p>${escapeHtml(item.asset)}</p>
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

export function renderIncomingRequestsPanel(items: UnscheduledItem[]): void {
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

export function initIncomingRequestsPanel(
  getItems: () => UnscheduledItem[],
): void {
  const list = document.querySelector<HTMLElement>("#incoming_requests_list");

  if (!list) {
    return;
  }

  list.addEventListener("dragstart", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const card = target.closest<HTMLElement>(".incoming-card");
    const dataTransfer = event.dataTransfer;

    if (!card || !dataTransfer) {
      return;
    }

    const requestId = card.dataset.requestId;
    const item = getItems().find((request) => String(request.id) === requestId);

    if (!item) {
      return;
    }

    card.classList.add("incoming-card--dragging");
    dataTransfer.effectAllowed = "move";
    dataTransfer.clearData();
    dataTransfer.setData("application/json", JSON.stringify(item));
    dataTransfer.setData("text/plain", String(item.id));
  });

  list.addEventListener("dragend", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    target
      .closest<HTMLElement>(".incoming-card")
      ?.classList.remove("incoming-card--dragging");
  });

  renderIncomingRequestsPanel(getItems());
}
