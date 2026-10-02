const DISPLAY_ALLOWED_RIGHTS = new Set([
  "http://rightsstatements.org/vocab/NoC-US/1.0/",
  "https://creativecommons.org/publicdomain/zero/1.0/",
  "https://creativecommons.org/publicdomain/mark/1.0/",
]);

export function normalizeRightsUri(rights: string | null): string | null {
  if (rights === null) {
    return null;
  }

  let normalized = rights.trim();

  if (normalized.length === 0) {
    return null;
  }

  if (!normalized.endsWith("/")) {
    normalized += "/";
  }

  if (normalized.startsWith("https://rightsstatements.org/")) {
    normalized = normalized.replace(
      "https://rightsstatements.org/",
      "http://rightsstatements.org/",
    );
  }

  if (normalized.startsWith("http://creativecommons.org/")) {
    normalized = normalized.replace(
      "http://creativecommons.org/",
      "https://creativecommons.org/",
    );
  }

  return normalized;
}

export function isDisplayEligible(rights: string | null): boolean {
  const normalized = normalizeRightsUri(rights);

  return normalized !== null && DISPLAY_ALLOWED_RIGHTS.has(normalized);
}
