const BEARER = /^Bearer\s+(.+)$/i;

export function parseKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  return match ? match[1] : null;
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function isAuthorized(header: string | null, keys: string[]): boolean {
  const presented = bearerToken(header);
  if (!presented || keys.length === 0) return false;

  // Compare against every key without short-circuiting so the number of
  // comparisons does not depend on which key matched.
  let authorized = false;
  for (const key of keys) {
    if (constantTimeEqual(presented, key)) authorized = true;
  }
  return authorized;
}

// Authenticate the complete token before treating its prefix as an identity.
// Client IDs are case-sensitive and end at the first "--" separator.
export function authenticatedClientId(header: string | null, keys: string[]): string | null {
  if (!isAuthorized(header, keys)) return null;
  const token = bearerToken(header)!;
  const separator = token.indexOf("--");
  if (separator <= 0 || separator + 2 === token.length || /\s/.test(token)) return null;
  return token.slice(0, separator);
}
