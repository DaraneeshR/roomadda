import fp from "fastify-plugin";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { AppError } from "../lib/errors.js";

export interface AuthUser {
  id: string;
  role: UserRole;
}

/**
 * Read the authenticated user inside a handler. Guaranteed present after the
 * `authenticate` preHandler; throws (rather than `!`) if a route forgot it.
 */
export function getAuthUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
  }
  return request.user;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyInstance {
    /** preHandler: verify the access JWT and attach req.user (401 on failure). */
    authenticate: preHandlerHookHandler;
    /**
     * preHandler for public-but-richer endpoints: if a bearer token is present
     * it is verified and req.user is attached; if absent, the request proceeds
     * anonymously. A present-but-invalid token still 401s.
     */
    optionalAuthenticate: preHandlerHookHandler;
    /** Factory: default-deny preHandler allowing only the listed roles. */
    requireRole: (...roles: UserRole[]) => preHandlerHookHandler;
    /** preHandler: require a VERIFIED KycRecord (403 KYC_REQUIRED otherwise). */
    requireKyc: preHandlerHookHandler;
  }
}

const unauthenticated = (message: string): AppError =>
  new AppError({ statusCode: 401, code: "UNAUTHENTICATED", message });

const authenticate: preHandlerHookHandler = async (request) => {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw unauthenticated("Missing bearer token");
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const claims = await verifyAccessToken(token);
    request.user = { id: claims.sub, role: claims.role };
  } catch {
    // Never leak why (expired vs malformed vs bad signature).
    throw unauthenticated("Invalid or expired token");
  }
};

const optionalAuthenticate: preHandlerHookHandler = async (request) => {
  const header = request.headers.authorization;
  if (!header) return; // anonymous caller — allowed
  if (!header.startsWith("Bearer ")) {
    throw unauthenticated("Malformed authorization header");
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const claims = await verifyAccessToken(token);
    request.user = { id: claims.sub, role: claims.role };
  } catch {
    throw unauthenticated("Invalid or expired token");
  }
};

function requireRole(...roles: UserRole[]): preHandlerHookHandler {
  return async function requireRoleHandler(request) {
    // Default-deny: authenticate must have run, and the role must be allowed.
    if (!request.user) {
      throw unauthenticated("Authentication required");
    }
    if (!roles.includes(request.user.role)) {
      throw new AppError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "You do not have permission to perform this action",
      });
    }
  };
}

const requireKyc: preHandlerHookHandler = async (request) => {
  if (!request.user) {
    throw unauthenticated("Authentication required");
  }
  const kyc = await prisma.kycRecord.findUnique({ where: { userId: request.user.id } });
  if (!kyc || kyc.status !== "VERIFIED") {
    throw new AppError({
      statusCode: 403,
      code: "KYC_REQUIRED",
      message: "KYC verification is required for this action",
    });
  }
};

export const authPlugin = fp(
  function auth(app, _opts, done) {
    app.decorate("authenticate", authenticate);
    app.decorate("optionalAuthenticate", optionalAuthenticate);
    app.decorate("requireRole", requireRole);
    app.decorate("requireKyc", requireKyc);
    done();
  },
  { name: "auth" },
);
