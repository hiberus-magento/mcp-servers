// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Country input for reports: an ISO two-letter code, or one of the names below.
// Ported from the original `normalizeCountry`, with one change that matters:
// the original fell back to upper-casing WHATEVER it was given and treating it
// as a code, so "Narnia" became "NARNIA", matched no order, and the report said
// zero — an answer that looks like data. An input that is neither a known name
// nor a two-letter code is now unrecognised (`undefined`), and the tool refuses
// it with a message instead of reporting an empty result.
const NAMES: Readonly<Record<string, string>> = {
  netherlands: "NL",
  "the netherlands": "NL",
  holland: "NL",
  "united states": "US",
  usa: "US",
  america: "US",
  "united kingdom": "GB",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  canada: "CA",
  australia: "AU",
  germany: "DE",
  france: "FR",
  italy: "IT",
  spain: "ES",
  belgium: "BE",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  ireland: "IE",
  switzerland: "CH",
  austria: "AT",
  portugal: "PT",
  greece: "GR",
  poland: "PL",
  japan: "JP",
  china: "CN",
  india: "IN",
  brazil: "BR",
  mexico: "MX",
  "south africa": "ZA",
};

const MAX_INPUT_LENGTH = 64;

export function normalizeCountry(input: string): string | undefined {
  const text = input.trim().toLowerCase();
  if (text.length === 0 || text.length > MAX_INPUT_LENGTH) {
    return undefined;
  }
  const named = NAMES[text];
  if (named !== undefined && Object.hasOwn(NAMES, text)) {
    return named;
  }
  return /^[a-z]{2}$/.test(text) ? text.toUpperCase() : undefined;
}
