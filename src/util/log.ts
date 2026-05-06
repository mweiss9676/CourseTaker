type Level = "info" | "warn" | "error" | "debug";

function ts(): string {
  return new Date().toISOString();
}

function emit(level: Level, msg: string, extra?: unknown): void {
  const line = `[${ts()}] ${level.toUpperCase()} ${msg}`;
  if (extra !== undefined) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
  debug: (msg: string, extra?: unknown) => {
    if (process.env.DEBUG) emit("debug", msg, extra);
  },
};
