// Structured JSON logging (spec §4) — minimal console sink until T02 ships the
// shared pino factory (INTEGRATION-DEBT: swap for core logger; call sites stay).
//
// Redaction is by construction: the API only accepts flat scalar fields, so
// there is no way to accidentally log a payload object (answers, secrets).
export type LogFields = Record<string, string | number | boolean | null>;

export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
};

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(base: LogFields, options: { level?: LogLevel; sink?: (line: string) => void } = {}): Logger {
  const sink = options.sink ?? ((line: string) => console.log(line));
  const threshold = LEVEL_ORDER[options.level ?? "info"];
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    sink(JSON.stringify({ level, msg, ...base, ...fields }));
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
