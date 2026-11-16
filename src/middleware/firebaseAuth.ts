/**
 * @fileoverview Firebase authentication middleware
 */

import type { Context, Next } from "hono";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  verifyIdToken,
  isAnonymousUser,
  isSiteAdmin,
} from "../services/firebase";
import { errorResponse } from "@sudobility/types";
import { eq } from "drizzle-orm";
import { db, users } from "../db";

declare module "hono" {
  interface ContextVariableMap {
    firebaseUser: DecodedIdToken;
    userId: string;
    userEmail: string | null;
    siteAdmin: boolean;
  }
}

/**
 * Ensure user record exists in database.
 * Uses firebase_uid as the unique identifier.
 */
async function ensureUserExists(
  firebaseUid: string,
  email?: string | null
): Promise<void> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.firebase_uid, firebaseUid));

  if (existing.length === 0) {
    await db.insert(users).values({
      firebase_uid: firebaseUid,
      email: email ?? null,
    });
  }
}

/**
 * Firebase authentication middleware.
 *
 * Verifies Firebase ID token and sets context variables:
 * - firebaseUser: The decoded Firebase token
 * - userId: The Firebase UID
 * - userEmail: The user's email (or null)
 * - siteAdmin: Whether the user is a site admin
 */
export async function firebaseAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    return c.json(errorResponse("Authorization header required"), 401);
  }

  const [type, token] = authHeader.split(" ");

  if (type !== "Bearer" || !token) {
    return c.json(
      errorResponse("Invalid authorization format. Use: Bearer <token>"),
      401
    );
  }

  try {
    const decodedToken = await verifyIdToken(token);

    if (isAnonymousUser(decodedToken)) {
      return c.json(
        errorResponse("Anonymous users cannot access this resource"),
        403
      );
    }

    // Set context variables
    c.set("firebaseUser", decodedToken);
    c.set("userId", decodedToken.uid);
    c.set("userEmail", decodedToken.email ?? null);
    c.set("siteAdmin", isSiteAdmin(decodedToken.email));

    // Ensure user exists in database (for profile data)
    // Run in background - don't block the request
    ensureUserExists(decodedToken.uid, decodedToken.email).catch(err =>
      console.error("Failed to ensure user exists:", err)
    );

    await next();
  } catch {
    return c.json(errorResponse("Invalid or expired Firebase token"), 401);
  }
}
