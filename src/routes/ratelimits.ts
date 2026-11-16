/**
 * @fileoverview Rate limits routes
 * @description Endpoints for retrieving rate limit configuration, current usage,
 * and usage history per entity. In whisperly, the rateLimitUserId path param
 * is the entity slug (not a user ID).
 */

import { Hono } from "hono";
import {
  successResponse,
  errorResponse,
  RateLimitPeriodType,
  type RateLimitsConfigResponse,
  type RateLimitHistoryResponse,
  type RateLimitsConfigData,
  type RateLimitHistoryData,
  type RateLimitTier,
} from "@sudobility/types";
import {
  getRateLimitRouteHandler,
  rateLimitsConfig,
  getTestMode,
} from "../middleware/rateLimit";
import { getEnv } from "../lib/env-helper";
import { entityHelpers } from "../lib/entity-config";
import { ErrorCode } from "../lib/error-codes";
import { TIER_DISPLAY_NAMES } from "../config/rateLimits";

const ratelimitsRouter = new Hono();

/**
 * Check if RevenueCat is configured
 */
function isRevenueCatConfigured(): boolean {
  const key = getEnv("REVENUECAT_API_KEY");
  return !!key && key.length > 0;
}

/**
 * Convert rateLimitsConfig object to array of RateLimitTier objects
 */
function convertConfigToTiersArray(): RateLimitTier[] {
  return Object.entries(rateLimitsConfig).map(([entitlement, limits]) => ({
    entitlement,
    displayName: TIER_DISPLAY_NAMES[entitlement] || entitlement,
    limits: {
      hourly: limits.hourly ?? null,
      daily: limits.daily ?? null,
      monthly: limits.monthly ?? null,
    },
  }));
}

/**
 * Verify user has access to entity and return its ID.
 * rateLimitUserId is taken from path parameter (this is an entity slug).
 */
async function getEntityIdForRateLimits(
  c: any,
  firebaseUid: string
): Promise<{
  entityId: string | null;
  error: string | null;
  errorCode: string | null;
}> {
  // In whisperly, rateLimitUserId is the entity slug
  const rateLimitUserId = c.req.param("rateLimitUserId");

  if (!rateLimitUserId) {
    return {
      entityId: null,
      error: "rateLimitUserId is required",
      errorCode: ErrorCode.ENTITY_SLUG_REQUIRED,
    };
  }

  // Look up entity by slug (rateLimitUserId is entity slug)
  const entity = await entityHelpers.entity.getEntityBySlug(rateLimitUserId);
  if (!entity) {
    return {
      entityId: null,
      error: "Entity not found",
      errorCode: ErrorCode.ENTITY_NOT_FOUND,
    };
  }

  // Verify user has access to this entity
  const canView = await entityHelpers.permissions.canViewEntity(
    entity.id,
    firebaseUid
  );
  if (!canView) {
    return {
      entityId: null,
      error: "Access denied to entity",
      errorCode: ErrorCode.ACCESS_DENIED,
    };
  }

  return { entityId: entity.id, error: null, errorCode: null };
}

/**
 * GET /ratelimits/:rateLimitUserId
 * Returns rate limit configurations for all entitlement tiers
 * and the current entity's usage.
 * In whisperly, rateLimitUserId is the entity slug.
 * Query params:
 *   - testMode: Optional, set to "true" for sandbox mode.
 * Note: Firebase auth is applied at the admin routes level.
 */
ratelimitsRouter.get("/", async c => {
  try {
    const testMode = getTestMode(c);

    // If RevenueCat is not configured, return static config without usage data
    if (!isRevenueCatConfigured()) {
      const noneLimits = rateLimitsConfig.none;
      const fallbackData: RateLimitsConfigData = {
        tiers: convertConfigToTiersArray(),
        currentEntitlement: "none",
        currentLimits: {
          hourly: noneLimits.hourly ?? null,
          daily: noneLimits.daily ?? null,
          monthly: noneLimits.monthly ?? null,
        },
        currentUsage: {
          hourly: 0,
          daily: 0,
          monthly: 0,
        },
      };
      return c.json(successResponse(fallbackData) as RateLimitsConfigResponse);
    }

    const firebaseUser = c.get("firebaseUser");

    // Get entity ID for rate limit lookup
    const {
      entityId,
      error: entityError,
      errorCode,
    } = await getEntityIdForRateLimits(c, firebaseUser.uid);

    if (entityError || !entityId) {
      const status =
        errorCode === ErrorCode.ENTITY_SLUG_REQUIRED
          ? 400
          : errorCode === ErrorCode.ACCESS_DENIED
            ? 403
            : 404;
      return c.json(
        {
          ...errorResponse(entityError || "Entity not found"),
          errorCode: errorCode || ErrorCode.ENTITY_NOT_FOUND,
        },
        status
      );
    }

    // Use entity ID for rate limits (subscriptions are per-entity)
    const data = await getRateLimitRouteHandler().getRateLimitsConfigData(
      entityId,
      testMode
    );

    return c.json(successResponse(data) as RateLimitsConfigResponse);
  } catch (error) {
    console.error("Error fetching rate limits config:", error);
    return c.json(
      {
        ...errorResponse("Failed to fetch rate limits"),
        errorCode: ErrorCode.INTERNAL_ERROR,
      },
      500
    );
  }
});

/**
 * GET /ratelimits/:rateLimitUserId/history/:periodType
 * Returns usage history for a specific period type.
 * In whisperly, rateLimitUserId is the entity slug.
 * periodType can be: hour, day, or month
 * Query params:
 *   - testMode: Optional, set to "true" for sandbox mode.
 */
ratelimitsRouter.get("/history/:periodType", async c => {
  try {
    const testMode = getTestMode(c);
    const periodTypeParam = c.req.param("periodType");

    // Validate period type
    if (!["hour", "day", "month"].includes(periodTypeParam)) {
      return c.json(
        {
          ...errorResponse(
            "Invalid period type. Must be one of: hour, day, month"
          ),
          errorCode: ErrorCode.INVALID_PERIOD_TYPE,
        },
        400
      );
    }

    // If RevenueCat is not configured, return empty history
    if (!isRevenueCatConfigured()) {
      const emptyHistory: RateLimitHistoryData = {
        periodType: periodTypeParam as RateLimitPeriodType,
        entries: [],
        totalEntries: 0,
      };
      return c.json(successResponse(emptyHistory) as RateLimitHistoryResponse);
    }

    const periodType = periodTypeParam as RateLimitPeriodType;
    const firebaseUser = c.get("firebaseUser");

    // Get entity ID for rate limit lookup
    const {
      entityId,
      error: entityError,
      errorCode,
    } = await getEntityIdForRateLimits(c, firebaseUser.uid);

    if (entityError || !entityId) {
      const status =
        errorCode === ErrorCode.ENTITY_SLUG_REQUIRED
          ? 400
          : errorCode === ErrorCode.ACCESS_DENIED
            ? 403
            : 404;
      return c.json(
        {
          ...errorResponse(entityError || "Entity not found"),
          errorCode: errorCode || ErrorCode.ENTITY_NOT_FOUND,
        },
        status
      );
    }

    // Use entity ID for rate limits (subscriptions are per-entity)
    const data = await getRateLimitRouteHandler().getRateLimitHistoryData(
      entityId,
      periodType,
      undefined, // use default limit
      testMode
    );

    return c.json(successResponse(data) as RateLimitHistoryResponse);
  } catch (error) {
    console.error("Error fetching rate limit history:", error);
    return c.json(
      {
        ...errorResponse("Failed to fetch rate limit history"),
        errorCode: ErrorCode.INTERNAL_ERROR,
      },
      500
    );
  }
});

export default ratelimitsRouter;
