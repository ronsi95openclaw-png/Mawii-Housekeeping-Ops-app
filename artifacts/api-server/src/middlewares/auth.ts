import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { db, employeesTable } from "@workspace/db";
import { asc, eq, like, sql } from "drizzle-orm";

export type AuthContext = { clerkUserId: string; role?: string };

declare global {
  namespace Express {
    interface Request { authContext?: AuthContext; }
  }
}

/**
 * Test-only bridge for integration tests. Preview and production must always
 * receive an identity verified by Clerk; a public preview must never trust a
 * caller-supplied header.
 */
export const attachAuth: RequestHandler = async (req, _res, next) => {
  try {
    const auth = getAuth(req);
    const testUserId = process.env.NODE_ENV === "test" ? req.header("x-dev-user-id") : undefined;
    const clerkUserId = auth.userId ?? testUserId;
    if (!clerkUserId) {
      next();
      return;
    }

    let employee = (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, clerkUserId)))[0];
    let isFirstUserBootstrap = false;
    if (!employee) {
      await db.transaction(async (tx) => {
        // Serializes the first-account check so two simultaneous Clerk sign-ins
        // cannot both become owners.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(913204771)`);
        employee = (await tx.select().from(employeesTable).where(eq(employeesTable.clerkUserId, clerkUserId)))[0];
        if (employee) return;

        const firstEmployee = (await tx.select().from(employeesTable).orderBy(asc(employeesTable.id)).limit(1))[0];
        // Dev fixtures and seeded rows keep the table non-empty, so "first user" means the
        // first real Clerk sign-in (Clerk ids are `user_…`), not the first row in the table.
        const linkedClerkUser = (await tx.select().from(employeesTable).where(like(employeesTable.clerkUserId, "user\\_%")).limit(1))[0];
        if (!firstEmployee || (auth.userId === clerkUserId && !linkedClerkUser)) {
          isFirstUserBootstrap = true;
          [employee] = await tx.insert(employeesTable).values({
            clerkUserId,
            name: "Mawii Owner",
            role: "owner",
          }).onConflictDoNothing().returning();
          employee ??= (await tx.select().from(employeesTable).where(eq(employeesTable.clerkUserId, clerkUserId)))[0];
        }
      });
    }

    const testRole = process.env.NODE_ENV === "test" ? req.header("x-dev-role") : undefined;
    // A deactivated employee keeps their row and history but carries no role, so every
    // role-gated route rejects them even while their Clerk session is still valid.
    const activeRole = employee?.active === "true" ? employee.role : undefined;
    req.authContext = { clerkUserId, role: activeRole ?? (isFirstUserBootstrap ? testRole : undefined) };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.authContext) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
};

/** Requires a Clerk identity that is linked to an active Mawii employee. */
export const requireActiveEmployee: RequestHandler = (req, res, next) => {
  if (!req.authContext) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!req.authContext.role) {
    res.status(403).json({ error: "An active employee profile is required" });
    return;
  }
  next();
};

export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.authContext || !roles.includes((req.authContext.role ?? "").toLowerCase())) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}
