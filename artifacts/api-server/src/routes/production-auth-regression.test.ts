import { describe, expect, it, vi } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: (req: { header(name: string): string | undefined }) => ({
    userId: req.header("x-test-clerk-user-id") ?? null,
  }),
}));

import app from "../app";
import { db, employeesTable } from "@workspace/db";

type Json = Record<string, unknown> | Array<unknown> | null;

const token = `production-auth-regression-${randomUUID()}`;
const cleanerUserId = `${token}-cleaner`;
const unknownUserId = `${token}-unknown`;

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose an address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api` };
}

async function request(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  let body: Json = null;
  if (text) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body };
}

function expectStatus(result: { status: number; body: Json }, status: number) {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  return result.body;
}

describe("production authentication boundary", () => {
  it(
    "rejects dev fallbacks and unknown identities while honoring stored employee roles",
    async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const { server, baseUrl } = await startServer();
      let cleanerId: number | undefined;

      try {
        const [cleaner] = await db.insert(employeesTable).values({
          clerkUserId: cleanerUserId,
          name: `${token} cleaner`,
          role: "cleaner",
          phone: "+12145550901",
        }).returning();
        cleanerId = cleaner.id;

        expectStatus(await request(baseUrl, "/jobs/assigned"), 401);
        expectStatus(await request(baseUrl, "/employees", {
          "x-dev-role": "owner",
        }), 401);
        expectStatus(await request(baseUrl, "/employees", {
          "x-dev-user-id": cleanerUserId,
          "x-dev-role": "owner",
        }), 401);
        expectStatus(await request(baseUrl, "/employees/me", {
          "x-dev-user-id": unknownUserId,
          "x-dev-role": "owner",
        }), 401);

        expectStatus(await request(baseUrl, "/employees/me", {
          "x-test-clerk-user-id": unknownUserId,
          "x-dev-role": "owner",
        }), 403);

        const knownEmployee = expectStatus(await request(baseUrl, "/employees/me", {
          "x-test-clerk-user-id": cleanerUserId,
          "x-dev-role": "owner",
        }), 200) as { clerkUserId: string; role: string };
        expect(knownEmployee).toMatchObject({
          clerkUserId: cleanerUserId,
          role: "cleaner",
        });
        expectStatus(await request(baseUrl, "/employees", {
          "x-test-clerk-user-id": cleanerUserId,
          "x-dev-role": "owner",
        }), 403);
        expectStatus(await request(baseUrl, "/employees", {
          "x-test-clerk-user-id": cleanerUserId,
          "x-dev-role": "manager",
        }), 403);
      } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (cleanerId !== undefined) {
          await db.delete(employeesTable).where(eq(employeesTable.id, cleanerId));
        }
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    },
    30_000,
  );
});