export type Resource = {
  key: string;
  name: string;
  label: string;
  description: string;
};

export type ScheduledItemStatus =
  | "scheduled"
  | "in_progress"
  | "waiting_parts"
  | "ready";

export type ScheduledItemPriority = "normal" | "urgent";

export type ScheduledItem = {
  id: number;
  text: string;
  start_date: string;
  end_date: string;
  resource_id: string;
  status: ScheduledItemStatus;
  priority: ScheduledItemPriority;
  requester: string;
  location: string;
  asset: string;
  issue: string;
  work_type: string;
};

export type UnscheduledItem = {
  id: number;
  text: string;
  requester: string;
  location: string;
  asset: string;
  issue: string;
  work_type: string;
  priority: ScheduledItemPriority;
  estimated_minutes: number;
};
