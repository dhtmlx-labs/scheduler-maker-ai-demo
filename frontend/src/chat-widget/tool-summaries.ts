import type { AvailabilityResult, CommandResult, SchedulerState } from "../scheduler/types.ts";
import { formatIdList, getItemIds, hasItemId } from "../scheduler/state-debug.ts";

function extractIds(params: unknown): Array<string | number> {
  if (!params || typeof params !== "object") {
    return [];
  }

  const maybeParams = params as {
    ids?: Array<string | number>;
    appointments?: Array<{ id?: string | number }>;
  };

  return maybeParams.ids ?? maybeParams.appointments?.flatMap((item) => (
    item.id == null ? [] : [item.id]
  )) ?? [];
}

export function getDuplicateGenerateScheduleRecovery(cmd: string, message: string, state: SchedulerState): string | null {
  if (cmd !== "generate_schedule") {
    return null;
  }

  const match = message.match(/generate_schedule cannot reuse existing scheduled appointment id:\s*([^\s.]+)/);

  if (!match) {
    return null;
  }

  const duplicateId = match[1];
  const isAlreadyInPreview = hasItemId(state.scheduledItems, duplicateId);

  return [
    `Recoverable duplicate generate_schedule attempt for id ${duplicateId}.`,
    isAlreadyInPreview
      ? `Request id ${duplicateId} is already included in the active preview/current scheduledItems.`
      : `Request id ${duplicateId} is already scheduled in the current state.`,
    "Do not call generate_schedule again for this id.",
    "Produce the final preview summary from the current state data instead.",
  ].join(" ");
}

function summarizeAvailabilityResult(result: unknown): string {
  const availability = result as AvailabilityResult | undefined;

  if (!availability?.resources?.length) {
    return "get_availability_windows completed. No resource availability rows were returned.";
  }

  const resourceSummaries = availability.resources.map((resource) => {
    const fittingWindows = resource.windows.filter((window) => window.can_fit);
    const windowSummary = fittingWindows.length
      ? fittingWindows
          .slice(0, 4)
          .map((window) => `${window.start_date}-${window.end_date}${window.candidate_end_date ? ` candidate_end_date ${window.candidate_end_date}` : ""}`)
          .join("; ")
      : "no fitting windows";

    return `${resource.resource_id}: occupied ${resource.occupied.length}; ${windowSummary}`;
  }).join(" | ");

  return [
    `get_availability_windows completed for ${availability.date}.`,
    `Working hours ${availability.working_hours.start}-${availability.working_hours.end}.`,
    `Lunch ${availability.lunch.start}-${availability.lunch.end} is ${availability.lunch.behavior}.`,
    resourceSummaries,
    "Use these facts to choose proposed appointments; this tool did not mutate live or preview state.",
  ].join(" ");
}

export function summarizeToolResult(cmd: string, params: unknown, state: SchedulerState, result?: CommandResult): string {
  const scheduledIds = formatIdList(getItemIds(state.scheduledItems));
  const unscheduledIds = formatIdList(getItemIds(state.unscheduledItems));
  const previewPrefix = state.preview?.active
    ? "Preview prepared. Live schedule is unchanged until the user clicks Apply."
    : "";

  if (cmd === "get_availability_windows") {
    return summarizeAvailabilityResult(result?.data);
  }

  if (cmd === "set_zoom") {
    return "set_zoom completed successfully. Confirm the Timeline range change briefly. Do not list scheduled or unscheduled items.";
  }

  if (cmd === "set_date") {
    return "set_date completed successfully. Confirm the date change briefly. Do not list scheduled or unscheduled items.";
  }

  if (cmd === "set_skin") {
    return "set_skin completed successfully. Confirm the skin change briefly. Do not list scheduled or unscheduled items.";
  }

  if (cmd === "delete_appointments") {
    const deletedIds = extractIds(params).join(", ") || "unknown";

    return [
      previewPrefix || `delete_appointments completed successfully. Deleted ids: ${deletedIds}.`,
      previewPrefix ? `Preview deleted ids: ${deletedIds}.` : "",
      `Current scheduled ids: ${scheduledIds}.`,
      "Do not call delete_appointments again for the same ids unless the user explicitly asks for another delete.",
    ].filter(Boolean).join(" ");
  }

  if (cmd === "unschedule_appointments") {
    const restoredIds = extractIds(params).join(", ") || "unknown";

    return [
      previewPrefix || `unschedule_appointments completed successfully. Restored incoming request ids: ${restoredIds}.`,
      previewPrefix ? `Preview restored incoming request ids: ${restoredIds}.` : "",
      `Current scheduled ids: ${scheduledIds}. Current unscheduled ids: ${unscheduledIds}.`,
    ].filter(Boolean).join(" ");
  }

  if (cmd === "generate_schedule") {
    const requestedGeneratedIds = extractIds(params);
    const actualGeneratedIds = requestedGeneratedIds.filter((id) => hasItemId(state.scheduledItems, id));
    const missingGeneratedIds = requestedGeneratedIds.filter((id) => !hasItemId(state.scheduledItems, id));
    const actualGeneratedIdList = formatIdList(actualGeneratedIds);
    const missingGeneratedIdList = formatIdList(missingGeneratedIds);
    const remainingUrgentItems = state.unscheduledItems.filter((item) => item.priority === "urgent");
    const remainingUrgentSummary = remainingUrgentItems
      .map((item) => `${item.id} (${item.text}, ${item.estimated_minutes} min, ${item.work_type})`)
      .join("; ");

    console.info("[scheduler-diagnostics] generate_schedule preview summary ids", {
      requestedGeneratedIds,
      actualGeneratedIds,
      missingGeneratedIds,
      previewActive: state.preview?.active === true,
      stateScheduledIds: getItemIds(state.scheduledItems),
      stateUnscheduledIds: getItemIds(state.unscheduledItems),
      remainingUrgentIds: getItemIds(remainingUrgentItems),
    });

    return [
      previewPrefix || "generate_schedule completed successfully.",
      `Requested generated request ids: ${requestedGeneratedIds.join(", ") || "unknown"}.`,
      `Generated request ids actually present in the current ${state.preview?.active ? "preview" : "state"}: ${actualGeneratedIdList}.`,
      missingGeneratedIds.length
        ? `Requested generated ids not present in the current ${state.preview?.active ? "preview" : "state"}: ${missingGeneratedIdList}. Do not claim these ids are included.`
        : "",
      `Preview scheduled ids: ${scheduledIds}. Preview unscheduled ids: ${unscheduledIds}.`,
      remainingUrgentItems.length
        ? `Urgent incoming requests still pending: ${remainingUrgentSummary}. If the user asked to schedule urgent incoming requests, this preview is incomplete unless each remaining urgent request has a concrete blocker. Continue planning any remaining urgent request that can fit today without moving/replacing existing scheduled work orders; ask only if moving/replacing work, changing date, or using an unsuitable resource is required.`
        : "No urgent incoming requests remain pending. If the user asked to schedule urgent incoming requests, the urgent preview set is complete.",
      "Reply that a preview is ready for review; do not say the live schedule changed. State only request ids actually present in the current preview/state as included. State which urgent request ids, if any, remain pending with the exact reason.",
    ].filter(Boolean).join(" ");
  }

  if (previewPrefix) {
    return `${previewPrefix} Preview scheduled ids: ${scheduledIds}. Preview unscheduled ids: ${unscheduledIds}. Reply that a preview is ready for review; do not say the live schedule changed.`;
  }

  return `${cmd} completed successfully. Current scheduled ids: ${scheduledIds}. Current unscheduled ids: ${unscheduledIds}.`;
}
