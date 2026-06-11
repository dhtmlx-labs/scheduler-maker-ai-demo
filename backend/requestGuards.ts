export function getStateIds(state: unknown, key: "scheduledItems" | "unscheduledItems"): Array<string | number> {
  if (!state || typeof state !== "object") {
    return [];
  }

  const items = (state as Record<string, unknown>)[key];

  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const id = (item as { id?: unknown }).id;

    return typeof id === "string" || typeof id === "number" ? [id] : [];
  });
}

export function hasActivePreview(state: unknown): boolean {
  if (!state || typeof state !== "object") {
    return false;
  }

  const preview = (state as { preview?: { active?: unknown } }).preview;

  return preview?.active === true;
}

function hasNoRemainingUrgentRequests(state: unknown): boolean {
  if (!state || typeof state !== "object") {
    return false;
  }

  const unscheduledItems = (state as { unscheduledItems?: unknown }).unscheduledItems;

  return Array.isArray(unscheduledItems) &&
    !unscheduledItems.some((item) => (
      item &&
      typeof item === "object" &&
      (item as { priority?: unknown }).priority === "urgent"
    ));
}

export function shouldFinalizeAfterGenerateSchedule(
  result: { ok: boolean; cmd: string; data?: unknown; summary?: string },
  userMessage: string,
): boolean {
  if (!result.ok || result.cmd !== "generate_schedule" || !hasActivePreview(result.data)) {
    return false;
  }

  const unscheduledIds = getStateIds(result.data, "unscheduledItems");
  const summary = result.summary ?? "";
  const isUrgentRequest = /\burgent\b/i.test(userMessage);

  return unscheduledIds.length === 0 ||
    (
      isUrgentRequest &&
      summary.includes("No urgent incoming requests remain pending") &&
      hasNoRemainingUrgentRequests(result.data)
    );
}

export function getDuplicateGenerateScheduleId(error: string): string | null {
  const match = error.match(/generate_schedule cannot reuse existing scheduled appointment id:\s*([^\s.]+)/);

  return match?.[1] ?? null;
}
