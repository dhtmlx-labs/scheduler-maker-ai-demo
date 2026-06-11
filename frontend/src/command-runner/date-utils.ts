import type { ScheduledItem, UnscheduledItem } from "../scheduler/types.ts";

const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const workStartMinutes = 9 * 60;
export const lunchStartMinutes = 12 * 60;
export const lunchEndMinutes = 13 * 60;
export const workEndMinutes = 18 * 60;

export function parseSchedulerDate(value: string): Date {
  const match = datePattern.exec(value);

  if (!match) {
    return new Date(Number.NaN);
  }

  const [datePart, timePart] = value.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes] = timePart.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  ) {
    return new Date(Number.NaN);
  }

  return date;
}

export function ensureDateString(value: string, field: string): void {
  if (!datePattern.test(value) || Number.isNaN(parseSchedulerDate(value).getTime())) {
    throw new Error(`Invalid ${field}: expected YYYY-MM-DD HH:mm`);
  }
}

export function parseDateOnly(value: string): Date {
  if (!dateOnlyPattern.test(value)) {
    return new Date(Number.NaN);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return new Date(Number.NaN);
  }

  return date;
}

export function getMinutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function formatSchedulerDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function setMinutesOfDay(date: Date, minutesOfDay: number): Date {
  const next = new Date(date);
  next.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
  return next;
}

export function calculateLunchAwareEndDate(startDate: Date, workingMinutes: number): Date {
  let cursor = new Date(startDate);
  let remainingMinutes = workingMinutes;

  while (remainingMinutes > 0) {
    const minutes = getMinutesOfDay(cursor);

    if (minutes >= lunchStartMinutes && minutes < lunchEndMinutes) {
      cursor = setMinutesOfDay(cursor, lunchEndMinutes);
      continue;
    }

    const nextPauseMinutes = minutes < lunchStartMinutes ? lunchStartMinutes : workEndMinutes;
    const availableMinutes = nextPauseMinutes - getMinutesOfDay(cursor);

    if (availableMinutes <= 0) {
      return addMinutes(cursor, remainingMinutes);
    }

    const stepMinutes = Math.min(remainingMinutes, availableMinutes);
    cursor = addMinutes(cursor, stepMinutes);
    remainingMinutes -= stepMinutes;
  }

  return cursor;
}

export function normalizeGeneratedAppointmentEndDate(
  appointment: ScheduledItem,
  unscheduledItem: UnscheduledItem,
): ScheduledItem {
  const startDate = parseSchedulerDate(appointment.start_date);
  const endDate = calculateLunchAwareEndDate(startDate, unscheduledItem.estimated_minutes);

  return {
    ...appointment,
    end_date: formatSchedulerDate(endDate),
  };
}

export function calculateWorkingMinutes(startDate: Date, endDate: Date): number {
  return Math.max(1, calculateExactWorkingMinutes(startDate, endDate));
}

export function calculateExactWorkingMinutes(startDate: Date, endDate: Date): number {
  const startMinutes = getMinutesOfDay(startDate);
  const endMinutes = getMinutesOfDay(endDate);
  const lunchOverlapMinutes = Math.max(
    0,
    Math.min(endMinutes, lunchEndMinutes) - Math.max(startMinutes, lunchStartMinutes),
  );

  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000) - lunchOverlapMinutes);
}

export function getElapsedMinutes(startDate: Date, endDate: Date): number {
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
}

export function getDatePart(value: string): string {
  return value.split(" ")[0] ?? "";
}
