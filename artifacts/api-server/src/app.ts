import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import { attachAuth } from "./middlewares/auth";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const localViteOrigins = new Set([
  "http://localhost:21201",
  "http://127.0.0.1:21201",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export function handleApiError(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error({ err, method: req.method, url: req.originalUrl }, "Unhandled API error");

  const errorWithStatus = typeof err === "object" && err !== null
    ? err as { status?: unknown; statusCode?: unknown }
    : {};
  const explicitStatus = [errorWithStatus.statusCode, errorWithStatus.status]
    .find((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599);
  const status = explicitStatus ?? 500;

  res.status(status).json({
    error: status === 500 ? "Internal server error" : "Request failed",
  });
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// The deployed web app and API share one origin. Development still allows the
// local Vite server, but no environment reflects arbitrary origins with
// credentials to authenticated API responses.
app.use(cors({
  origin: (origin, callback) => {
    callback(null, !origin || (process.env.NODE_ENV === "development" && localViteOrigins.has(origin)));
  },
  credentials: true,
}));
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(clerkMiddleware());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(attachAuth);

app.use("/api", router);
app.use(handleApiError);

export default app;
