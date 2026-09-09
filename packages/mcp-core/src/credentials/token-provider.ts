// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// TokenProvider and credential loading (design.md, Decision 5). Two
// implementations, neither domain-specific: `StaticTokenProvider` resolves
// once (`invalidate` is a no-op); `MintedTokenProvider` is expiry-aware with
// single-flight coalescing (concurrent callers share one in-flight mint) and
// a generation stamp so a 401 invalidates only the generation that produced
// it. There is no refresh grant — expiry re-mints from scratch.
export interface Remedy {
  readonly domain: string;
  readonly cliCommand: string;
  readonly envVar: string;
  readonly configPath: string;
  readonly reason: string;
}

export type Credential =
  | { readonly kind: "static"; readonly value: string }
  | { readonly kind: "minted"; readonly value: string; readonly expiresAt: number };

export interface TokenProvider {
  readonly domain: string;
  /** Never prompts, never reads stdin, never hangs. */
  getToken(): Promise<Credential>;
  /** After a 401, invalidate only the generation that produced it. */
  invalidate(generation: number): void;
  describeRemedy(): Remedy;
}

function formatRemedyMessage(prefix: string, remedy: Remedy): string {
  return (
    `${prefix} for domain "${remedy.domain}".\n` +
    `Run:      ${remedy.cliCommand}     (reads the token from stdin)\n` +
    `Or set:   ${remedy.envVar}=<value>\n` +
    `Checked:  ${remedy.configPath}   (${remedy.reason})`
  );
}

export class MissingCredentialError extends Error {
  readonly remedy: Remedy;

  constructor(remedy: Remedy) {
    super(formatRemedyMessage("Missing credential", remedy));
    this.name = "MissingCredentialError";
    this.remedy = remedy;
  }
}

export class CredentialExpiredError extends Error {
  readonly remedy: Remedy;

  constructor(remedy: Remedy) {
    super(formatRemedyMessage("Credential expired", remedy));
    this.name = "CredentialExpiredError";
    this.remedy = remedy;
  }
}

export interface StaticTokenProviderOptions {
  readonly domain: string;
  readonly resolve: () => string;
  readonly remedy: Remedy;
}

export class StaticTokenProvider implements TokenProvider {
  readonly domain: string;
  readonly #resolve: () => string;
  readonly #remedy: Remedy;

  constructor(options: StaticTokenProviderOptions) {
    this.domain = options.domain;
    this.#resolve = options.resolve;
    this.#remedy = options.remedy;
  }

  async getToken(): Promise<Credential> {
    let value: string;
    try {
      value = this.#resolve();
    } catch {
      throw new MissingCredentialError(this.#remedy);
    }
    return { kind: "static", value };
  }

  invalidate(): void {
    // A static credential (e.g. a restricted access key) has nothing to
    // invalidate — the caller must rotate it out-of-band.
  }

  describeRemedy(): Remedy {
    return this.#remedy;
  }
}

interface MintedValue {
  readonly value: string;
  readonly expiresAt: number;
}

export interface MintedTokenProviderOptions {
  readonly domain: string;
  readonly mint: () => Promise<MintedValue>;
  /** Required — no default. A hung mint call fails fast instead of stalling a tool call. */
  readonly mintTimeoutMs: number;
  readonly skewMs?: number;
  readonly remedy: Remedy;
}

interface CachedMint extends MintedValue {
  readonly generation: number;
}

export class MintedTokenProvider implements TokenProvider {
  readonly domain: string;
  readonly #mint: () => Promise<MintedValue>;
  readonly #mintTimeoutMs: number;
  readonly #skewMs: number;
  readonly #remedy: Remedy;
  #generation = 0;
  #cached: CachedMint | undefined;
  #inFlight: Promise<Credential> | undefined;

  constructor(options: MintedTokenProviderOptions) {
    this.domain = options.domain;
    this.#mint = options.mint;
    this.#mintTimeoutMs = options.mintTimeoutMs;
    this.#skewMs = options.skewMs ?? 0;
    this.#remedy = options.remedy;
  }

  /** Not part of `TokenProvider` — lets a domain-specific 401 handler learn which generation to invalidate. */
  getGeneration(): number {
    return this.#generation;
  }

  async getToken(): Promise<Credential> {
    const now = Date.now();
    if (this.#cached && this.#cached.expiresAt - this.#skewMs > now) {
      return { kind: "minted", value: this.#cached.value, expiresAt: this.#cached.expiresAt };
    }
    if (this.#inFlight) {
      return this.#inFlight;
    }

    const generation = this.#generation;
    const mintPromise = this.#mintForGeneration(generation);
    this.#inFlight = mintPromise;
    try {
      return await mintPromise;
    } finally {
      this.#inFlight = undefined;
    }
  }

  async #mintForGeneration(generation: number): Promise<Credential> {
    const minted = await this.#mintWithTimeout();
    this.#cached = { ...minted, generation };
    return { kind: "minted", value: minted.value, expiresAt: minted.expiresAt };
  }

  #mintWithTimeout(): Promise<MintedValue> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new MissingCredentialError(this.#remedy));
      }, this.#mintTimeoutMs);
      this.#mint().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new MissingCredentialError(this.#remedy));
        },
      );
    });
  }

  invalidate(generation: number): void {
    if (this.#cached && this.#cached.generation === generation) {
      this.#cached = undefined;
    }
    if (generation === this.#generation) {
      this.#generation += 1;
    }
  }

  describeRemedy(): Remedy {
    return this.#remedy;
  }
}
