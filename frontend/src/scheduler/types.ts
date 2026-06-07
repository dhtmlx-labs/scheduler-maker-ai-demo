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

export type SchedulerItemId = string | number;

export type ScheduledItem = {
  id: SchedulerItemId;
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
  id: SchedulerItemId;
  text: string;
  requester: string;
  location: string;
  asset: string;
  issue: string;
  work_type: string;
  priority: ScheduledItemPriority;
  estimated_minutes: number;
};

export type SchedulerState = {
  scheduledItems: ScheduledItem[];
  unscheduledItems: UnscheduledItem[];
  resources: Resource[];
};

export type CommandResult<T = unknown> = {
  ok: true;
  cmd: string;
  data: T;
};
