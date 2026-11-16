/**
 * @fileoverview User routes for Whisperly API
 */

import { Hono } from "hono";
import {
  NONE_ENTITLEMENT,
  successResponse,
  errorResponse,
  type BackendSubscriptionResult,
  type UserInfoResponse,
} from "@sudobility/types";
import { getUserInfo } from "../services/firebase";
import { getSubscriptionHelper, getTestMode } from "../middleware/subscription";

const usersRouter = new Hono();

/**
 * GET /users/:userId
 *
 * Get user information including siteAdmin status.
 * Requires the Firebase token to match the requested userId.
 * Returns 403 if token doesn't match or user not found.
 *
 * Note: This route is under adminRoutes which applies firebaseAuthMiddleware,
 * so c.get("userId") is already available.
 */
usersRouter.get("/:userId", async c => {
  const requestedUserId = c.req.param("userId");
  const tokenUserId = c.get("userId");

  // Verify the token belongs to the requested user
  if (requestedUserId !== tokenUserId) {
    return c.json(errorResponse("Token does not match requested user"), 403);
  }

  const userInfo = await getUserInfo(requestedUserId);

  if (!userInfo) {
    return c.json(errorResponse("User not found"), 403);
  }

  return c.json(successResponse<UserInfoResponse>(userInfo));
});

/**
 * GET /users/:userId/subscriptions
 *
 * Get user subscription status (requires Firebase auth).
 */
usersRouter.get("/:userId/subscriptions", async c => {
  const requestedUserId = c.req.param("userId");
  const tokenUserId = c.get("userId");

  if (requestedUserId !== tokenUserId) {
    return c.json(
      errorResponse("You can only access your own subscription"),
      403
    );
  }

  const subHelper = getSubscriptionHelper();
  if (!subHelper) {
    return c.json(errorResponse("Subscription service not configured"), 500);
  }

  try {
    const testMode = getTestMode(c);
    const subscriptionInfo = await subHelper.getSubscriptionInfo(
      requestedUserId,
      testMode
    );
    const subscriptionResult: BackendSubscriptionResult = {
      hasSubscription:
        subscriptionInfo.entitlements.length > 0 &&
        !subscriptionInfo.entitlements.includes(NONE_ENTITLEMENT),
      entitlements: subscriptionInfo.entitlements,
      subscriptionStartedAt:
        subscriptionInfo.subscriptionStartedAt?.toISOString() ?? null,
      platform: subscriptionInfo.platform,
      productIdentifier: subscriptionInfo.productIdentifier,
      expiresDate: subscriptionInfo.expiresDate?.toISOString() ?? null,
      willRenew: subscriptionInfo.willRenew,
      managementUrl: subscriptionInfo.managementUrl,
    };
    return c.json(
      successResponse<BackendSubscriptionResult>(subscriptionResult)
    );
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return c.json(errorResponse("Failed to fetch subscription status"), 500);
  }
});

export default usersRouter;
