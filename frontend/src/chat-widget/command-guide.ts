import { sanitizeText } from "./message-rendering.ts";

type CommandGuideItem = {
  command: string;
  title: string;
  description: string;
  prompt: string;
};

type CommandGuideSection = {
  id: string;
  title: string;
  items: CommandGuideItem[];
};

export const contextualSchedulePrompts = [
  "Move the emergency exit light work order to Nina later today.",
  "Find a free slot for the lobby spill cleanup.",
  "Mark the parking level fixture repair as ready.",
  "Move the access card enrollment work order back to Incoming Requests.",
  "Switch to week view.",
  "Use the dark skin.",
];

export const commandGuideSections: CommandGuideSection[] = [
  {
    id: "planning",
    title: "Planning and State",
    items: [
      {
        command: "get_scheduler_state",
        title: "Inspect current schedule",
        description: "Read scheduled work orders, incoming requests, resources, and preview status.",
        prompt: "What is currently scheduled and which incoming requests are still waiting?",
      },
      {
        command: "get_availability_windows",
        title: "Check availability",
        description: "Find occupied intervals and free windows before scheduling or rescheduling.",
        prompt: "Find availability today for a 90 minute HVAC request.",
      },
      {
        command: "generate_schedule",
        title: "Prepare a schedule preview",
        description: "Create proposed work orders from Incoming Requests. The live schedule changes only after Apply.",
        prompt: "Generate today's schedule from pending maintenance requests.",
      },
    ],
  },
  {
    id: "work-orders",
    title: "Work Orders",
    items: [
      {
        command: "add_appointment",
        title: "Add one work order",
        description: "Prepare a preview with a new scheduled maintenance work order.",
        prompt: "Schedule a 90 minute HVAC inspection for Floor 9 this afternoon with Alex.",
      },
      {
        command: "update_appointments",
        title: "Reschedule or update",
        description: "Move or edit existing scheduled work orders by id or description.",
        prompt: "Move the access control work later this afternoon.",
      },
      {
        command: "delete_appointments",
        title: "Delete work orders",
        description: "Prepare a preview that removes scheduled work orders.",
        prompt: "Delete the parking level fixture repair.",
      },
      {
        command: "unschedule_appointments",
        title: "Move back to Incoming Requests",
        description: "Return scheduled work orders to the custom Incoming Requests panel.",
        prompt: "Move the access card enrollment work order back to Incoming Requests.",
      },
      {
        command: "clear_all",
        title: "Clear scheduled work",
        description: "Prepare a preview that clears scheduled work orders, optionally including incoming requests.",
        prompt: "Clear all scheduled work orders.",
      },
    ],
  },
  {
    id: "scheduler-view",
    title: "Scheduler View",
    items: [
      {
        command: "set_date",
        title: "Jump to date",
        description: "Change the visible Scheduler date without changing work orders.",
        prompt: "Show tomorrow's schedule.",
      },
      {
        command: "set_zoom",
        title: "Change Timeline range",
        description: "Use day, 3-day, or week Timeline ranges.",
        prompt: "Set the Timeline range to week.",
      },
      {
        command: "set_skin",
        title: "Change skin",
        description: "Use an allowed DHTMLX Scheduler skin.",
        prompt: "Use the dark skin.",
      },
    ],
  },
];

export function renderPromptButtons(prompts: string[]): string {
  return prompts
    .map((prompt) => `<button class="prompt-pill" type="button">${sanitizeText(prompt)}</button>`)
    .join("");
}

export function renderContextualSuggestions(): string {
  return `
    <div class="chat-suggestions">
      <p>Next useful commands:</p>
      <div class="chat-suggestions__pills">
        ${renderPromptButtons(contextualSchedulePrompts)}
      </div>
    </div>
  `;
}

export function renderCommandGuideModal(): string {
  return `
    <div id="chat_command_guide" class="command-guide" hidden>
      <div class="command-guide__overlay" data-command-guide-close></div>
      <section class="command-guide__panel" role="dialog" aria-modal="true" aria-labelledby="command_guide_title">
        <header class="command-guide__header">
          <div>
            <p class="eyebrow">Help</p>
            <h2 id="command_guide_title">Command Guide</h2>
          </div>
          <button class="command-guide__close" type="button" aria-label="Close command guide" data-command-guide-close>Close</button>
        </header>
        <div class="command-guide__body">
          <section class="command-guide__intro">
            <p>Use chat to inspect the Scheduler, prepare previews, adjust the visible Timeline, and manage Incoming Requests.</p>
            <p>Incoming Requests are unscheduled cards outside DHTMLX Scheduler. Drag a card into the Timeline to schedule it manually, or ask the assistant to prepare a preview. Scheduled work orders can also be moved back to Incoming Requests with <code>unschedule_appointments</code>.</p>
          </section>
          <nav class="command-guide__nav" aria-label="Command guide sections">
            <ul>
              ${commandGuideSections.map((section) => `
                <li><a href="#command-guide-${sanitizeText(section.id)}">${sanitizeText(section.title)}</a></li>
              `).join("")}
            </ul>
          </nav>
          ${commandGuideSections.map((section) => `
            <section class="command-guide__section" id="command-guide-${sanitizeText(section.id)}">
              <h3>${sanitizeText(section.title)}</h3>
              <div class="command-guide__items">
                ${section.items.map((item) => `
                  <article class="command-guide__item">
                    <div>
                      <strong>${sanitizeText(item.command)}</strong>
                      <h4>${sanitizeText(item.title)}</h4>
                      <p>${sanitizeText(item.description)}</p>
                      <code>${sanitizeText(item.prompt)}</code>
                    </div>
                    <button class="command-guide__copy" type="button" data-prompt="${sanitizeText(item.prompt)}">Copy</button>
                  </article>
                `).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}
