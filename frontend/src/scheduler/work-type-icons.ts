const workTypeIcons: Record<string, string> = {
  "access control": "🔐",
  cleaning: "✨",
  electrical: "⚡",
  hvac: "🌡️",
  inspection: "🔎",
  plumbing: "💧",
};

const resourceCapabilityIcons: Array<{ pattern: RegExp; icon: string }> = [
  { pattern: /hvac|mechanical/i, icon: "🌡️" },
  { pattern: /mechanical|repair/i, icon: "🔧" },
  { pattern: /electrical/i, icon: "⚡" },
  { pattern: /lighting/i, icon: "💡" },
  { pattern: /plumbing/i, icon: "💧" },
  { pattern: /access control/i, icon: "🔐" },
  { pattern: /elevator/i, icon: "↕️" },
];

export function getWorkTypeIcon(workType: string): string {
  return workTypeIcons[workType.trim().toLowerCase()] ?? "🔧";
}

export function getResourceCapabilityIcons(description: string): string[] {
  const icons = resourceCapabilityIcons
    .filter(({ pattern }) => pattern.test(description))
    .map(({ icon }) => icon);

  return Array.from(new Set(icons));
}
