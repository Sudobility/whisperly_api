/**
 * @fileoverview Shared entity permission helpers
 * @description Provides unified `getEntityWithPermission` and `verifyProjectOwnership`
 * functions used across multiple route files. Eliminates duplication that previously
 * existed in dictionary.ts, project-languages.ts, projects.ts, and analytics.ts.
 */

import { eq, and } from "drizzle-orm";
import { db, projects } from "../db";
import { entityHelpers } from "./entity-config";
import { ErrorCode, type ErrorCodeType } from "./error-codes";
import type { Entity } from "@sudobility/entity_service";

/** Result type for getEntityWithPermission - success case */
interface EntityPermissionSuccess {
  entity: Entity;
  error?: never;
  errorCode?: never;
}

/** Result type for getEntityWithPermission - error case */
interface EntityPermissionError {
  entity?: never;
  error: string;
  errorCode: ErrorCodeType;
}

/** Discriminated union result for entity permission checks */
export type EntityPermissionResult =
  EntityPermissionSuccess | EntityPermissionError;

/**
 * Get entity by slug and verify user membership with appropriate permissions.
 *
 * Returns a discriminated union: either `{ entity }` on success or
 * `{ error, errorCode }` on failure.
 *
 * @param entitySlug - The entity's URL slug
 * @param userId - The Firebase UID of the requesting user
 * @param requireEdit - If true, checks for edit/create permission instead of view-only
 * @returns Entity on success, or error message with error code on failure
 *
 * @example
 * ```typescript
 * const result = await getEntityWithPermission("my-org", userId, true);
 * if (result.error !== undefined) {
 *   return c.json({ ...errorResponse(result.error), errorCode: result.errorCode }, 403);
 * }
 * // result.entity is available here
 * ```
 */
export async function getEntityWithPermission(
  entitySlug: string,
  userId: string,
  requireEdit = false
): Promise<EntityPermissionResult> {
  const entity = await entityHelpers.entity.getEntityBySlug(entitySlug);
  if (!entity) {
    return { error: "Entity not found", errorCode: ErrorCode.ENTITY_NOT_FOUND };
  }

  if (requireEdit) {
    const canEdit = await entityHelpers.permissions.canCreateProjects(
      entity.id,
      userId
    );
    if (!canEdit) {
      return {
        error: "Your role does not have permission to create projects",
        errorCode: ErrorCode.ROLE_CANNOT_CREATE_PROJECTS,
      };
    }
  } else {
    const canView = await entityHelpers.permissions.canViewEntity(
      entity.id,
      userId
    );
    if (!canView) {
      return { error: "Access denied", errorCode: ErrorCode.ACCESS_DENIED };
    }
  }

  return { entity };
}

/**
 * HTTP status code to use for an entity permission error.
 *
 * @param errorCode - The error code from the permission check
 * @returns 404 for entity-not-found, 403 for all permission errors
 */
export function getEntityErrorStatus(errorCode: ErrorCodeType): 403 | 404 {
  return errorCode === ErrorCode.ENTITY_NOT_FOUND ? 404 : 403;
}

/**
 * Verify that a project belongs to the given entity.
 *
 * @param entityId - The entity UUID
 * @param projectId - The project UUID
 * @returns The project row if found, or null if not found / doesn't belong to entity
 */
export async function verifyProjectOwnership(
  entityId: string,
  projectId: string
) {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.entity_id, entityId), eq(projects.id, projectId)));

  return rows.length > 0 ? rows[0]! : null;
}
