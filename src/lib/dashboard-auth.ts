import { timingSafeEqual } from "node:crypto";

const DASHBOARD_HEADER = "x-agromat-dashboard-auth";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Verifies the private header injected by nginx after successful Basic Auth.
 * The application port must remain bound to loopback so callers cannot bypass
 * nginx and provide this header directly.
 */
export function isDashboardRequest(request: Request): boolean {
  const expected = process.env.DASHBOARD_PROXY_SECRET;
  if (!expected) {
    // Keep local development usable, but never fail open in production.
    return process.env.NODE_ENV !== "production";
  }
  const actual = request.headers.get(DASHBOARD_HEADER) || "";
  return safeEqual(actual, expected);
}

/** Verifies a server-only Bearer token from one of the supplied env variables. */
export function hasServerBearer(request: Request, ...envNames: string[]): boolean {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length);
  return envNames.some((name) => {
    const expected = process.env[name];
    return Boolean(expected && safeEqual(token, expected));
  });
}
