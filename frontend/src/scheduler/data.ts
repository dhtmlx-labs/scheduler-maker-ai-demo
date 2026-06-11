
import type { Resource, ScheduledItem, UnscheduledItem } from "./types.ts";

export const demoDate = new Date();

export function getDemoDateString(): string {
  const year = demoDate.getFullYear();
  const month = String(demoDate.getMonth() + 1).padStart(2, "0");
  const day = String(demoDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function toDemoDateTime(time: string): string {
  return `${getDemoDateString()} ${time}`;
}

export const resources: Resource[] = [
  {
    key: "alex",
    name: "Alex Rivera",
    label: "Alex Rivera - HVAC and mechanical",
    description: "HVAC and mechanical",
  },
  {
    key: "nina",
    name: "Nina Patel",
    label: "Nina Patel - Electrical and lighting",
    description: "Electrical and lighting",
  },
  {
    key: "marek",
    name: "Marek Nowak",
    label: "Marek Nowak - Plumbing and cleaning",
    description: "Plumbing and cleaning",
  },
  {
    key: "sofia",
    name: "Sofia Chen",
    label: "Sofia Chen - Access control and elevators",
    description: "Access control and elevators",
  },
];

export const seedScheduledItems: ScheduledItem[] = [
  {
    id: 1,
    text: "Air handler temperature fault",
    start_date: toDemoDateTime("09:00"),
    end_date: toDemoDateTime("10:30"),
    resource_id: "alex",
    requester: "Emma Thompson, Facilities Manager",
    location: "Floor 12 mechanical room",
    asset: "AHU-12 east zone",
    issue: "Open office area is holding at 27 C despite cooling setpoint",
    work_type: "HVAC",
    status: "scheduled",
    priority: "urgent",
  },
  {
    id: 2,
    text: "Conference room lighting outage",
    start_date: toDemoDateTime("10:30"),
    end_date: toDemoDateTime("12:00"),
    resource_id: "nina",
    requester: "Daniel Brooks, Tenant Coordinator",
    location: "Floor 8, Room 8.14",
    asset: "Lighting circuit L8-C",
    issue: "Dimmable fixtures flicker and two panels are out",
    work_type: "Electrical",
    status: "in_progress",
    priority: "normal",
  },
  {
    id: 3,
    text: "Restroom leak inspection",
    start_date: toDemoDateTime("09:00"),
    end_date: toDemoDateTime("11:30"),
    resource_id: "marek",
    requester: "Olivia Martin, Office Manager",
    location: "Floor 6 west restroom",
    asset: "Sink supply line",
    issue: "Water pooling under the vanity after morning use",
    work_type: "Plumbing",
    status: "scheduled",
    priority: "normal",
  },
  {
    id: 4,
    text: "Badge reader reset",
    start_date: toDemoDateTime("10:00"),
    end_date: toDemoDateTime("11:00"),
    resource_id: "sofia",
    requester: "Liam Chen, Security Desk",
    location: "North lobby entrance",
    asset: "Access reader N-01",
    issue: "Tenant badges intermittently fail on first scan",
    work_type: "Access control",
    status: "scheduled",
    priority: "normal",
  },
  {
    id: 5,
    text: "Pantry drain slow",
    start_date: toDemoDateTime("13:00"),
    end_date: toDemoDateTime("14:30"),
    resource_id: "marek",
    requester: "Mia Gonzalez, Tenant Services",
    location: "Floor 10 pantry",
    asset: "Kitchenette sink drain",
    issue: "Drain backs up after dishwasher cycle",
    work_type: "Plumbing",
    status: "scheduled",
    priority: "normal",
  },
  {
    id: 6,
    text: "Elevator door sensor check",
    start_date: toDemoDateTime("13:00"),
    end_date: toDemoDateTime("15:30"),
    resource_id: "sofia",
    requester: "Noah Williams, Building Operations",
    location: "Elevator bank B",
    asset: "Elevator B2 door sensor",
    issue: "Doors reopen repeatedly during peak traffic",
    work_type: "Inspection",
    status: "waiting_parts",
    priority: "urgent",
  },
  {
    id: 7,
    text: "Server room cooling alarm",
    start_date: toDemoDateTime("14:00"),
    end_date: toDemoDateTime("16:00"),
    resource_id: "alex",
    requester: "Ava Johnson, IT Lead",
    location: "Floor 3 server room",
    asset: "CRAC unit SR-3",
    issue: "High-temperature alarm triggered twice overnight",
    work_type: "HVAC",
    status: "scheduled",
    priority: "urgent",
  },
  {
    id: 8,
    text: "Parking level fixture repair",
    start_date: toDemoDateTime("15:00"),
    end_date: toDemoDateTime("17:00"),
    resource_id: "nina",
    requester: "Ethan Clark, Property Manager",
    location: "Parking level P2",
    asset: "Lighting circuit P2-S",
    issue: "Three fixtures are dark near the south stairwell",
    work_type: "Electrical",
    status: "ready",
    priority: "normal",
  },
];

export const seedUnscheduledItems: UnscheduledItem[] = [
  {
    id: 101,
    text: "Thermostat not responding",
    requester: "Grace Kim",
    location: "Floor 9, Suite 904",
    asset: "Zone thermostat T9-04",
    issue: "Tenant cannot adjust temperature and display is blank",
    work_type: "HVAC",
    priority: "normal",
    estimated_minutes: 90,
  },
  {
    id: 102,
    text: "Emergency exit light failed",
    requester: "Henry Adams",
    location: "Floor 4 east stairwell",
    asset: "Exit sign E4-2",
    issue: "Emergency light failed during weekly safety check",
    work_type: "Electrical",
    priority: "urgent",
    estimated_minutes: 120,
  },
  {
    id: 103,
    text: "Access card enrollment issue",
    requester: "Sophie Baker",
    location: "Security office",
    asset: "Access control system",
    issue: "New employee badges fail to sync to lobby readers",
    work_type: "Access control",
    priority: "normal",
    estimated_minutes: 75,
  },
  {
    id: 104,
    text: "Lobby spill cleanup",
    requester: "Lucas Meyer",
    location: "Main lobby",
    asset: "Terrazzo floor near reception",
    issue: "Coffee spill near visitor check-in creates slip risk",
    work_type: "Cleaning",
    priority: "urgent",
    estimated_minutes: 105,
  },
];
