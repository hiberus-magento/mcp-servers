// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Allowlist by FULL subcommand, never prefix or regex (design.md,
// Decision 4). `#commands` is a `Map` keyed on the exact
// `[bin, ...subcommand].join(' ')` string, resolved via `.get()` — an exact
// lookup structurally cannot prefix-match. `ssh`, `tunnel`, and `db:dump`
// are rejected at registration time: a forbidden command cannot even be
// constructed, so the process fails to boot rather than failing per call.
import { basename } from "node:path";
import type { z } from "zod";
import type { CommandSpec } from "./command-spec.js";

const FORBIDDEN_TOKENS = new Set(["ssh", "tunnel", "db:dump"]);

function commandKey(bin: string, subcommand: readonly string[]): string {
  return [bin, ...subcommand].join(" ");
}

function isForbidden(bin: string, subcommand: readonly string[]): boolean {
  // Checks the resolved binary's basename (so `/usr/bin/ssh` is caught, not
  // only a bare `ssh`) plus every subcommand token (so `myctl db:dump` is
  // caught too), never a substring/prefix test — `Set.has` on exact tokens
  // only.
  const tokens = [basename(bin), ...subcommand];
  return tokens.some((token) => FORBIDDEN_TOKENS.has(token));
}

export class ForbiddenCommandError extends Error {
  constructor(bin: string, subcommand: readonly string[]) {
    super(`Refusing to register forbidden command "${commandKey(bin, subcommand)}".`);
    this.name = "ForbiddenCommandError";
  }
}

export class CommandAllowlist {
  readonly #commands = new Map<string, CommandSpec<z.ZodTypeAny>>();

  register<A extends z.ZodTypeAny>(spec: CommandSpec<A>): CommandSpec<A> {
    if (isForbidden(spec.bin, spec.subcommand)) {
      throw new ForbiddenCommandError(spec.bin, spec.subcommand);
    }
    this.#commands.set(commandKey(spec.bin, spec.subcommand), spec as CommandSpec<z.ZodTypeAny>);
    return spec;
  }

  resolve(bin: string, subcommand: readonly string[]): CommandSpec<z.ZodTypeAny> | undefined {
    return this.#commands.get(commandKey(bin, subcommand));
  }

  /** For registry introspection (e.g. a conformance suite asserting a
   * read-only tool's executor never registered a command outside its
   * declared read allowlist) — never used by the executor itself. */
  listCommandKeys(): string[] {
    return [...this.#commands.keys()];
  }
}
