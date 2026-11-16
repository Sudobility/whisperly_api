/**
 * @fileoverview User Invitation Routes
 * @description API routes for managing user's pending invitations.
 * Uses errorResponse() from whisperly_types for consistent error formatting.
 */

import { Hono } from "hono";
import {
  successResponse,
  errorResponse,
  type EntityInvitation,
} from "@sudobility/types";
import { entityHelpers } from "../lib/entity-config";
import { ErrorCode } from "../lib/error-codes";

type Variables = {
  userId: string;
  userEmail: string | null;
};

const invitationsRouter = new Hono<{ Variables: Variables }>();

/**
 * GET /invitations - List pending invitations for the current user
 */
invitationsRouter.get("/", async c => {
  const userEmail = c.get("userEmail");

  if (!userEmail) {
    return c.json(successResponse<EntityInvitation[]>([]));
  }

  try {
    const invitations =
      await entityHelpers.invitations.getUserPendingInvitations(userEmail);
    return c.json(successResponse<EntityInvitation[]>(invitations));
  } catch (error: any) {
    console.error("Error listing user invitations:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INTERNAL_ERROR },
      500
    );
  }
});

/**
 * POST /invitations/:token/accept - Accept an invitation
 */
invitationsRouter.post("/:token/accept", async c => {
  const userId = c.get("userId");
  const token = c.req.param("token");

  try {
    await entityHelpers.invitations.acceptInvitation(token, userId);
    return c.json(successResponse<null>(null));
  } catch (error: any) {
    console.error("Error accepting invitation:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

/**
 * POST /invitations/:token/decline - Decline an invitation
 */
invitationsRouter.post("/:token/decline", async c => {
  const token = c.req.param("token");

  try {
    await entityHelpers.invitations.declineInvitation(token);
    return c.json(successResponse<null>(null));
  } catch (error: any) {
    console.error("Error declining invitation:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

export default invitationsRouter;
