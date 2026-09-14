import { describe, expect, it } from "vitest";
import express from "express";
import http, { type Server } from "node:http";
import { handleApiError } from "./app";

describe("API error handling", () => {
  it("returns generic JSON without exposing error details or paths", async () => {
    const testApp = express();
    testApp.get("/error-probe", () => {
      throw Object.assign(new Error("secret failure from /workspace/src/routes/probe.ts"), { statusCode: 418 });
    });
    testApp.use(handleApiError);

    const server: Server = http.createServer(testApp);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose an address");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/error-probe`);
      const text = await response.text();
      expect(response.status).toBe(418);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(text).not.toContain("secret failure");
      expect(text).not.toContain("/workspace/src/routes/probe.ts");
      expect(text).not.toContain("Error:");
      const payload = JSON.parse(text) as { error?: unknown; serverStartedAt?: unknown };
      expect(Object.keys(payload).sort()).toEqual(["error", "serverStartedAt"]);
      expect(payload.error).toBe("Request failed");
      const { serverStartedAt } = payload;
      expect(typeof serverStartedAt).toBe("string");
      if (typeof serverStartedAt !== "string") throw new Error("serverStartedAt must be a string");
      expect(serverStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(serverStartedAt).toISOString()).toBe(serverStartedAt);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});