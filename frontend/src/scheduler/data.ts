
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
    label: "Alex Rivera - Diagnostics and EV systems",
    description: "Diagnostics and EV systems",
  },
  {
    key: "nina",
    name: "Nina Patel",
    label: "Nina Patel - Brakes and suspension",
    description: "Brakes and suspension",
  },
  {
    key: "marek",
    name: "Marek Nowak",
    label: "Marek Nowak - Engine and drivetrain",
    description: "Engine and drivetrain",
  },
  {
    key: "sofia",
    name: "Sofia Chen",
    label: "Sofia Chen - Electrical and infotainment",
    description: "Electrical and infotainment",
  },
];

export const seedScheduledItems: ScheduledItem[] = [
  {
    id: 1,
    text: "EV range diagnostic",
    start_date: toDemoDateTime("09:00"),
    end_date: toDemoDateTime("10:30"),
    resource_id: "alex",
    requester: "Emma Thompson",
    location: "Bay 1",
    asset: "2024 Hyundai Ioniq 5",
    issue: "Range estimate drops after overnight charge",
    work_type: "EV diagnostic",
    status: "scheduled",
    priority: "urgent",
  },
  {
    id: 2,
    text: "Brake vibration inspection",
    start_date: toDemoDateTime("10:30"),
    end_date: toDemoDateTime("12:00"),
    resource_id: "nina",
    requester: "Daniel Brooks",
    location: "Bay 2",
    asset: "2021 Toyota RAV4",
    issue: "Steering wheel vibration under braking",
    work_type: "Brake inspection",
    status: "in_progress",
    priority: "normal",
  },
  {
    id: 3,
    text: "Oil leak and belt noise",
    start_date: toDemoDateTime("09:00"),
    end_date: toDemoDateTime("11:30"),
    resource_id: "marek",
    requester: "Olivia Martin",
    location: "Bay 3",
    asset: "2018 Ford Transit",
    issue: "Oil spots under engine and squeal on cold start",
    work_type: "Engine repair",
    status: "scheduled",
    priority: "normal",
  },
  {
    id: 4,
    text: "Infotainment reboot",
    start_date: toDemoDateTime("10:00"),
    end_date: toDemoDateTime("11:00"),
    resource_id: "sofia",
    requester: "Liam Chen",
    location: "Bay 4",
    asset: "2022 Volkswagen ID.4",
    issue: "Center screen reboots while using navigation",
    work_type: "Infotainment",
    status: "scheduled",
    priority: "normal",
  },
  {
    id: 5,
    text: "Suspension clunk",
    start_date: toDemoDateTime("13:00"),
    end_date: toDemoDateTime("14:30"),
    resource_id: "nina",
    requester: "Mia Gonzalez",
    location: "Bay 5",
    asset: "2020 Subaru Outback",
    issue: "Front-end clunk over speed bumps",
    work_type: "Suspension",
    status: "scheduled",
    priority: "normal",
  },
  {
    id: 6,
    text: "Transmission hesitation",
    start_date: toDemoDateTime("13:00"),
    end_date: toDemoDateTime("15:30"),
    resource_id: "marek",
    requester: "Noah Williams",
    location: "Bay 6",
    asset: "2019 BMW 330i",
    issue: "Hesitation shifting from second to third",
    work_type: "Drivetrain",
    status: "waiting_parts",
    priority: "urgent",
  },
  {
    id: 7,
    text: "Charging port fault",
    start_date: toDemoDateTime("14:00"),
    end_date: toDemoDateTime("16:00"),
    resource_id: "alex",
    requester: "Ava Johnson",
    location: "Bay 7",
    asset: "2023 Kia EV6",
    issue: "Intermittent AC charging disconnect",
    work_type: "EV systems",
    status: "scheduled",
    priority: "urgent",
  },
  {
    id: 8,
    text: "ADAS camera calibration",
    start_date: toDemoDateTime("15:00"),
    end_date: toDemoDateTime("17:00"),
    resource_id: "sofia",
    requester: "Ethan Clark",
    location: "Bay 8",
    asset: "2021 Honda Accord",
    issue: "Lane assist warning after windshield replacement",
    work_type: "Electrical calibration",
    status: "ready",
    priority: "normal",
  },
];

export const seedUnscheduledItems: UnscheduledItem[] = [
  {
    id: 101,
    text: "Check engine light diagnostic",
    requester: "Grace Kim",
    location: "Intake",
    asset: "2020 Mazda CX-5",
    issue: "Warning light after highway driving",
    work_type: "Diagnostics",
    priority: "normal",
    estimated_minutes: 90,
  },
  {
    id: 102,
    text: "Brake pedal soft",
    requester: "Henry Adams",
    location: "Intake",
    asset: "2017 Honda CR-V",
    issue: "Brake pedal feels soft in city traffic",
    work_type: "Brake inspection",
    priority: "urgent",
    estimated_minutes: 120,
  },
  {
    id: 103,
    text: "Heated seat electrical fault",
    requester: "Sophie Baker",
    location: "Intake",
    asset: "2022 Volvo XC60",
    issue: "Driver seat heater stops after two minutes",
    work_type: "Electrical",
    priority: "normal",
    estimated_minutes: 75,
  },
  {
    id: 104,
    text: "EV charging cable release",
    requester: "Lucas Meyer",
    location: "Intake",
    asset: "2023 Nissan Ariya",
    issue: "Charging cable lock does not release consistently",
    work_type: "EV systems",
    priority: "urgent",
    estimated_minutes: 105,
  },
];
