const CLR = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  green: "\x1b[32m",
};

function timestamp(): string {
  return `${CLR.gray}[${new Date().toISOString()}]${CLR.reset}`;
}

function paint(color: string, label: string): string {
  return `${color}${label}${CLR.reset}`;
}

export const log = {
  info: (...msg: unknown[]) => console.log(timestamp(), paint(CLR.cyan, "INFO "), ...msg),
  warn: (...msg: unknown[]) => console.warn(timestamp(), paint(CLR.yellow, "WARN "), ...msg),
  error: (...msg: unknown[]) => console.error(timestamp(), paint(CLR.red, "ERROR"), ...msg),
  success: (...msg: unknown[]) => console.log(timestamp(), paint(CLR.green, "OK   "), ...msg),
};
