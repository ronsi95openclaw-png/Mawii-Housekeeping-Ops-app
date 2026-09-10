import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { db, employeesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

export type AuthContext = { clerkUserId: string; role?: string };

declare global {
  namespace Express {
    interface Request { authContext?: AuthContext; }
  }
}

/** Development bridge: X-Dev-User-Id is accepted only outside production. */
export const attachAuth: RequestHandler = async (req, _res, next) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth.userId ?? (process.env.NODE_ENV !== "production" ? (req.header("x-dev-user-id") ?? "dev-user") : undefined);
    if (!clerkUserId) {
      next();
      return;
    }

    let employee = (await db.select().from(employeesTable).where(eq(employeesTable.clerkUserId, clerkUserId)))[0];
    let isFirstUserBootstrap = false;
    if (!employee) {
      const firstEmployee = (await db.select().from(employeesTable).orderBy(asc(employeesTable.id)).limit(1))[0];
      if (!firstEmployee) {
        isFirstUserBootstrap = true;
        [employee] = await db.insert(employeesTable).values({
          clerkUserId,
          name: "Mawii Owner",
          role: "owner",
        }).returning();
      }
    }

    const developmentRole = process.env.NODE_ENV !== "production" ? req.header("x-dev-role") : undefined;
    req.authContext = { clerkUserId, role: employee?.role ?? (isFirstUserBootstrap ? developmentRole : undefined) };
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

export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.authContext || !roles.includes((req.authContext.role ?? "").toLowerCase())) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}