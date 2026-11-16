/**
 * @fileoverview Whisperly API entry point
 * @description Hono application setup with CORS, logging, error handling, health checks,
 * body size limits, and API route mounting. Initializes the database on startup.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { initDatabase, db } from "./db";
import routes from "./routes";
import {
  successResponse,
  errorResponse,
  type HealthResponse,
} from "@sudobility/types";
import { getEnv } from "./lib/env-helper";
import { ErrorCode } from "./lib/error-codes";
import { sql } from "drizzle-orm";

const app = new Hono();

// Global error handler - return structured JSON errors
app.onError((err, c) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  const isDev = getEnv("NODE_ENV") !== "production";

  // Structured error logging
  const errorLog = {
    timestamp: new Date().toISOString(),
    error: message,
    path: c.req.path,
    method: c.req.method,
    ...(isDev && err instanceof Error ? { stack: err.stack } : {}),
  };
  console.error("Unhandled error:", JSON.stringify(errorLog));

  return c.json(
    {
      ...errorResponse(
        isDev && err instanceof Error && err.stack
          ? `${message}\n\n${err.stack}`
          : message
      ),
      errorCode: ErrorCode.INTERNAL_ERROR,
    },
    500
  );
});

// Middleware
app.use("*", logger());
app.use("*", cors());

// Body size limit: 2MB for all routes (prevents oversized payloads)
app.use(
  "*",
  bodyLimit({
    maxSize: 2 * 1024 * 1024, // 2MB
    onError: c => {
      return c.json(
        {
          ...errorResponse("Request body too large (max 2MB)"),
          errorCode: ErrorCode.INVALID_INPUT,
        },
        413
      );
    },
  })
);

// Health check endpoint
// Single canonical /health returning { status, version, detail } with dependency
// checks folded into `detail`. `/` mirrors the same payload.
const buildHealthResponse = async (): Promise<HealthResponse> => {
  const checks: Record<
    string,
    { status: string; latencyMs?: number; error?: string }
  > = {};

  // Check database connectivity
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = {
      status: "unhealthy",
      latencyMs: Date.now() - dbStart,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  // Check translation service availability
  const translationUrl = getEnv("TRANSLATION_SERVICE_URL");
  checks.translation_service = translationUrl
    ? { status: "configured" }
    : { status: "not_configured" };

  // Check email service availability
  const resendKey = getEnv("RESEND_API_KEY");
  checks.email_service = resendKey
    ? { status: "configured" }
    : { status: "not_configured" };

  // Check RevenueCat availability
  const revenueCatKey = getEnv("REVENUECAT_API_KEY");
  checks.rate_limiting = revenueCatKey
    ? { status: "configured" }
    : { status: "disabled" };

  return {
    status: checks.database.status === "healthy" ? "healthy" : "unhealthy",
    version: "1.0.0",
    detail: {
      ...checks,
      uptime: process.uptime(),
    },
  };
};

app.get("/", async c =>
  c.json(successResponse<HealthResponse>(await buildHealthResponse()))
);
app.get("/health", async c =>
  c.json(successResponse<HealthResponse>(await buildHealthResponse()))
);

// API routes
app.route("/api/v1", routes);

// Initialize database and start server
const port = parseInt(getEnv("PORT", "3000")!);

initDatabase()
  .then(() => {
    console.log(`Whisperly API running on http://localhost:${port}`);
  })
  .catch(err => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });

export default {
  port,
  fetch: app.fetch,
};

// Export app for testing
export { app };
