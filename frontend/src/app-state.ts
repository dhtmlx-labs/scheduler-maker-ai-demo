import { resources, seedScheduledItems, seedUnscheduledItems } from "./scheduler/data.ts";

export const appState = {
  scheduledItems: seedScheduledItems.map((item) => ({ ...item })),
  unscheduledItems: seedUnscheduledItems.map((item) => ({ ...item })),
  resources,
};
