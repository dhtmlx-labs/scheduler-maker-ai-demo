import "./incoming-requests.css";
import type { UnscheduledPreviewItem } from "../preview/preview-session.ts";

let dragDisabled = false;

export function setIncomingRequestsDragDisabled(disabled: boolean): void {
  dragDisabled = disabled;
}

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

function getPreviewLabel(item: UnscheduledPreviewItem): string {
  switch (item.preview_kind) {
    case "existing":
      return "Waiting";
    case "proposed_new":
      return "Restored";
    case "proposed_removed":
      return "Scheduling";
    default:
      return "";
  }
}

function renderRequestCard(item: UnscheduledPreviewItem): string {
  const previewLabel = getPreviewLabel(item);
  const className = [
    "incoming-card",
    item.preview_kind ? "incoming-card--preview" : "",
    item.preview_kind ? `incoming-card--preview-${item.preview_kind}` : "",
  ].filter(Boolean).join(" ");

  return `
    <article
      class="${className}"
      draggable="${dragDisabled ? "false" : "true"}"
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
          ${previewLabel ? `<span class="incoming-card__preview">${escapeHtml(previewLabel)}</span>` : ""}
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

export function renderIncomingRequestsPanel(items: UnscheduledPreviewItem[]): void {
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
  getItems: () => UnscheduledPreviewItem[],
): void {
  const list = document.querySelector<HTMLElement>("#incoming_requests_list");

  if (!list) {
    return;
  }

  list.addEventListener("dragstart", (event) => {
    if (dragDisabled) {
      event.preventDefault();
      return;
    }

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
