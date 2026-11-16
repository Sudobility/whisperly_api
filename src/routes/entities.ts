/**
 * @fileoverview Entity Routes
 * @description API routes for entity/organization management.
 * Uses errorResponse() from whisperly_types for consistent error formatting.
 */

import { Hono } from "hono";
import {
  successResponse,
  errorResponse,
  type Entity,
  type EntityWithRole,
  type EntityMember,
  type EntityInvitation,
} from "@sudobility/types";
import { entityHelpers } from "../lib/entity-config";
import { ErrorCode } from "../lib/error-codes";
import { sendInvitationEmail } from "../services/email";

type Variables = {
  userId: string; // This is the firebase_uid directly
  userEmail: string | null;
};

const entitiesRouter = new Hono<{ Variables: Variables }>();

// =============================================================================
// Entity CRUD Routes
// =============================================================================

/**
 * GET /entities - List all entities for the current user
 */
entitiesRouter.get("/", async c => {
  const userId = c.get("userId"); // firebase_uid
  const userEmail = c.get("userEmail");

  try {
    const userEntities = await entityHelpers.entity.getUserEntities(
      userId,
      userEmail ?? undefined
    );
    return c.json(successResponse<EntityWithRole[]>(userEntities));
  } catch (error: any) {
    console.error("Error listing entities:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INTERNAL_ERROR },
      500
    );
  }
});

/**
 * POST /entities - Create a new organization entity
 */
entitiesRouter.post("/", async c => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const { displayName, entitySlug, description } = body;

  if (!displayName) {
    return c.json(
      {
        ...errorResponse("displayName is required"),
        errorCode: ErrorCode.DISPLAY_NAME_REQUIRED,
      },
      400
    );
  }

  try {
    const entity = await entityHelpers.entity.createOrganizationEntity(userId, {
      displayName,
      entitySlug,
      description,
    });
    return c.json(successResponse<Entity>(entity), 201);
  } catch (error: any) {
    console.error("Error creating entity:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

/**
 * GET /entities/:entitySlug - Get entity by slug
 */
entitiesRouter.get("/:entitySlug", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user is a member
    const isMember = await entityHelpers.members.isMember(entity.id, userId);
    if (!isMember) {
      return c.json(
        {
          ...errorResponse("Access denied"),
          errorCode: ErrorCode.ACCESS_DENIED,
        },
        403
      );
    }

    const role = await entityHelpers.members.getUserRole(entity.id, userId);
    const entityWithRole: EntityWithRole = { ...entity, userRole: role! };
    return c.json(successResponse<EntityWithRole>(entityWithRole));
  } catch (error: any) {
    console.error("Error getting entity:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INTERNAL_ERROR },
      500
    );
  }
});

/**
 * PUT /entities/:entitySlug - Update entity
 */
entitiesRouter.put("/:entitySlug", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");
  const body = await c.req.json();

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can edit
    const canEdit = await entityHelpers.permissions.canEditEntity(
      entity.id,
      userId
    );
    if (!canEdit) {
      return c.json(
        {
          ...errorResponse("Insufficient permissions"),
          errorCode: ErrorCode.ROLE_CANNOT_EDIT_ENTITY,
        },
        403
      );
    }

    const updated = await entityHelpers.entity.updateEntity(entity.id, body);
    return c.json(successResponse<Entity>(updated));
  } catch (error: any) {
    console.error("Error updating entity:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

/**
 * DELETE /entities/:entitySlug - Delete entity (organizations only)
 */
entitiesRouter.delete("/:entitySlug", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can delete
    const canDelete = await entityHelpers.permissions.canDeleteEntity(
      entity.id,
      userId
    );
    if (!canDelete) {
      return c.json(
        {
          ...errorResponse("Insufficient permissions"),
          errorCode: ErrorCode.ROLE_CANNOT_DELETE_ENTITY,
        },
        403
      );
    }

    await entityHelpers.entity.deleteEntity(entity.id);
    return c.json(successResponse<null>(null));
  } catch (error: any) {
    console.error("Error deleting entity:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

// =============================================================================
// Member Routes
// =============================================================================

/**
 * GET /entities/:entitySlug/members - List members
 */
entitiesRouter.get("/:entitySlug/members", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can view
    const canView = await entityHelpers.permissions.canViewEntity(
      entity.id,
      userId
    );
    if (!canView) {
      return c.json(
        {
          ...errorResponse("Access denied"),
          errorCode: ErrorCode.ACCESS_DENIED,
        },
        403
      );
    }

    const members = await entityHelpers.members.getMembers(entity.id);
    return c.json(successResponse<EntityMember[]>(members));
  } catch (error: any) {
    console.error("Error listing members:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INTERNAL_ERROR },
      500
    );
  }
});

/**
 * PUT /entities/:entitySlug/members/:memberId - Update member role
 */
entitiesRouter.put("/:entitySlug/members/:memberId", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");
  const memberId = c.req.param("memberId");
  const body = await c.req.json();

  const { role } = body;
  if (!role) {
    return c.json(
      {
        ...errorResponse("role is required"),
        errorCode: ErrorCode.ROLE_REQUIRED,
      },
      400
    );
  }

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can manage members
    const canManage = await entityHelpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(
        {
          ...errorResponse("Insufficient permissions"),
          errorCode: ErrorCode.ROLE_CANNOT_MANAGE_MEMBERS,
        },
        403
      );
    }

    const updated = await entityHelpers.members.updateMemberRole(
      entity.id,
      memberId,
      role
    );
    return c.json(successResponse<EntityMember>(updated));
  } catch (error: any) {
    console.error("Error updating member role:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

/**
 * DELETE /entities/:entitySlug/members/:memberId - Remove member
 */
entitiesRouter.delete("/:entitySlug/members/:memberId", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");
  const memberId = c.req.param("memberId");

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can manage members
    const canManage = await entityHelpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(
        {
          ...errorResponse("Insufficient permissions"),
          errorCode: ErrorCode.ROLE_CANNOT_MANAGE_MEMBERS,
        },
        403
      );
    }

    await entityHelpers.members.removeMember(entity.id, memberId);
    return c.json(successResponse<null>(null));
  } catch (error: any) {
    console.error("Error removing member:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

// =============================================================================
// Invitation Routes
// =============================================================================

/**
 * GET /entities/:entitySlug/invitations - List pending invitations
 */
entitiesRouter.get("/:entitySlug/invitations", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can manage members (required to see invitations)
    const canManage = await entityHelpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(
        {
          ...errorResponse("Insufficient permissions"),
          errorCode: ErrorCode.ROLE_CANNOT_MANAGE_MEMBERS,
        },
        403
      );
    }

    const invitations = await entityHelpers.invitations.getEntityInvitations(
      entity.id
    );
    return c.json(successResponse<EntityInvitation[]>(invitations));
  } catch (error: any) {
    console.error("Error listing invitations:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INTERNAL_ERROR },
      500
    );
  }
});

/**
 * POST /entities/:entitySlug/invitations - Create invitation
 */
entitiesRouter.post("/:entitySlug/invitations", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");
  const body = await c.req.json();

  const { email, role } = body;
  if (!email || !role) {
    return c.json(
      {
        ...errorResponse("email and role are required"),
        errorCode: ErrorCode.INVITATION_EMAIL_ROLE_REQUIRED,
      },
      400
    );
  }

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can invite members
    const canInvite = await entityHelpers.permissions.canInviteMembers(
      entity.id,
      userId
    );
    if (!canInvite) {
      return c.json(
        {
          ...errorResponse("Insufficient permissions"),
          errorCode: ErrorCode.ROLE_CANNOT_INVITE_MEMBERS,
        },
        403
      );
    }

    const invitation = await entityHelpers.invitations.createInvitation(
      entity.id,
      userId,
      {
        email,
        role,
      }
    );

    // Send invite email (non-blocking)
    sendInvitationEmail({
      recipientEmail: email,
      entityName: entity.displayName,
    }).catch(err => console.error("Failed to send invitation email:", err));

    return c.json(successResponse<EntityInvitation>(invitation), 201);
  } catch (error: any) {
    console.error("Error creating invitation:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

/**
 * PUT /entities/:entitySlug/invitations/:invitationId - Renew invitation
 * Renews the invitation with a new 14-day expiration and resends email
 */
entitiesRouter.put("/:entitySlug/invitations/:invitationId", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");
  const invitationId = c.req.param("invitationId");

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can manage members (admin only)
    const canManage = await entityHelpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(
        {
          ...errorResponse("Insufficient permissions"),
          errorCode: ErrorCode.ROLE_CANNOT_MANAGE_MEMBERS,
        },
        403
      );
    }

    const renewed =
      await entityHelpers.invitations.renewInvitation(invitationId);

    // Resend invite email (non-blocking)
    sendInvitationEmail({
      recipientEmail: renewed.email,
      entityName: entity.displayName,
    }).catch(err => console.error("Failed to resend invitation email:", err));

    return c.json(successResponse<EntityInvitation>(renewed));
  } catch (error: any) {
    console.error("Error renewing invitation:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

/**
 * DELETE /entities/:entitySlug/invitations/:invitationId - Cancel invitation
 */
entitiesRouter.delete("/:entitySlug/invitations/:invitationId", async c => {
  const userId = c.get("userId");
  const entitySlug = c.req.param("entitySlug");
  const invitationId = c.req.param("invitationId");

  try {
    const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(
        {
          ...errorResponse("Entity not found"),
          errorCode: ErrorCode.ENTITY_NOT_FOUND,
        },
        404
      );
    }

    // Check if user can manage members
    const canManage = await entityHelpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(
        {
          ...errorResponse("Insufficient permissions"),
          errorCode: ErrorCode.ROLE_CANNOT_MANAGE_MEMBERS,
        },
        403
      );
    }

    await entityHelpers.invitations.cancelInvitation(invitationId);
    return c.json(successResponse<null>(null));
  } catch (error: any) {
    console.error("Error canceling invitation:", error);
    return c.json(
      { ...errorResponse(error.message), errorCode: ErrorCode.INVALID_INPUT },
      400
    );
  }
});

export default entitiesRouter;
