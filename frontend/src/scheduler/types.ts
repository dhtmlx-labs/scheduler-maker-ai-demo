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
  preview?: {
    active: boolean;
    liveStateUnchanged: boolean;
  };
};

export type AvailabilityOccupiedInterval = {
  id: SchedulerItemId;
  start_date: string;
  end_date: string;
  text: string;
};

export type AvailabilityWindow = {
  start_date: string;
  end_date: string;
  available_elapsed_minutes: number;
  available_working_minutes: number;
  can_fit: boolean;
  candidate_end_date?: string;
};

export type ResourceAvailability = {
  resource_id: string;
  resource_label: string;
  resource_description: string;
  occupied: AvailabilityOccupiedInterval[];
  windows: AvailabilityWindow[];
};

export type AvailabilityResult = {
  date: string;
  working_hours: {
    start: string;
    end: string;
  };
  lunch: {
    start: string;
    end: string;
    behavior: "pause_only_not_occupied";
  };
  resources: ResourceAvailability[];
};

export type CommandResult<T = unknown> = {
  ok: true;
  cmd: string;
  data: T;
};
