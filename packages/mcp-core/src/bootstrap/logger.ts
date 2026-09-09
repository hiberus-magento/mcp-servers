// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Structural stdout safety (design.md, Decision 2, mechanism M2's runtime
// half). The only logging surface application code should use. Every level
// writes to stderr; there is no code path in this module that touches
// process.stdout.
export type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, message: string): void {
  const line = `[${level.toUpperCase()}] ${message}\n`;
  process.stderr.write(line);
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const logger: Logger = {
  info(message: string): void {
    write("info", message);
  },
  warn(message: string): void {
    write("warn", message);
  },
  error(message: string): void {
    write("error", message);
  },
};
