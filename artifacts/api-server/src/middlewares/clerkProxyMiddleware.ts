import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";

export const CLERK_PROXY_PATH = "/api/__clerk";
export function getClerkProxyHost(req: { headers: { host?: string; "x-forwarded-host"?: string | string[] } }): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() || req.headers.host?.trim();
}

/** Clerk's browser API proxy. It is deliberately inert in development. */
export function clerkProxyMiddleware(): RequestHandler {
  if (process.env.NODE_ENV !== "production" || !process.env.CLERK_SECRET_KEY) {
    return (_req, _res, next) => next();
  }
  return createProxyMiddleware({
    target: "https://frontend-api.clerk.dev",
    changeOrigin: true,
    pathRewrite: (path) => path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const host = getClerkProxyHost(req);
        if (host) proxyReq.setHeader("Clerk-Proxy-Url", `https://${host}${CLERK_PROXY_PATH}`);
        proxyReq.setHeader("Clerk-Secret-Key", process.env.CLERK_SECRET_KEY!);
      },
    },
  }) as RequestHandler;
}