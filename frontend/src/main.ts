import "./style.css";

import { initIncomingRequestsPanel } from "./incoming-requests.ts";
import { initSchedulerBoard } from "./scheduler/scheduler-board.ts";
import { seedScheduledItems, seedUnscheduledItems } from "./scheduler/data.ts";

const scheduledItems = [...seedScheduledItems];
const unscheduledItems = [...seedUnscheduledItems];

initIncomingRequestsPanel(unscheduledItems);
initSchedulerBoard(scheduledItems);
