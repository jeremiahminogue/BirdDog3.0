import type { Context } from "hono";

/**
 * Get the authenticated user's companyId from the request context.
 * Call this inside any route handler after requireAuth middleware has run.
 */
export function getCompanyId(c: Context): number {
  const user = c.get("user");
  if (!user?.companyId) {
    throw new Error("No companyId on authenticated user");
  }
  return user.companyId;
}

/**
 * Check if the current user is a super_admin (can operate across companies).
 */
export function isSuperAdmin(c: Context): boolean {
  const user = c.get("user");
  return user?.role === "super_admin";
}
