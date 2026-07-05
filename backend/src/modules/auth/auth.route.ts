import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { isProduction } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { serializeUserSelf } from "../users/users.serializer.js";
import { authService, type IssuedSession } from "./auth.service.js";
import {
  logoutSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordChangeSchema,
  passwordLoginSchema,
  refreshSchema,
  type ClientType,
} from "./auth.schema.js";

const REFRESH_COOKIE = "rt";
const REFRESH_COOKIE_PATH = "/v1/auth";

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction, // always Secure in prod; relaxed locally for http
    sameSite: "strict" as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: 30 * 24 * 60 * 60,
  };
}

/**
 * Deliver a session per client type: web gets the refresh token in an
 * httpOnly+Secure+SameSite=strict cookie (never the body); mobile gets it in
 * the body to store in secure storage. The access token always goes in the body.
 */
function sendSession(reply: FastifyReply, client: ClientType, session: IssuedSession) {
  const user = serializeUserSelf(session.user);
  if (client === "web") {
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions());
    return reply.send({ accessToken: session.accessToken, user });
  }
  return reply.send({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user,
  });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Request an OTP. Always 202 regardless of whether the number exists.
  app.post("/auth/otp/request", async (request, reply) => {
    const body = otpRequestSchema.parse(request.body);
    const result = await authService.requestOtp({ phone: body.phone, ip: request.ip });
    return reply.status(202).send({ status: "sent", expiresInSeconds: result.expiresInSeconds });
  });

  // Verify an OTP and start a session.
  app.post("/auth/otp/verify", async (request, reply) => {
    const body = otpVerifySchema.parse(request.body);
    const session = await authService.verifyOtp({
      phone: body.phone,
      code: body.code,
      ip: request.ip,
      appAudience: body.appAudience,
    });
    return sendSession(reply, body.client, session);
  });

  // Rotate the refresh token (token from cookie for web, body for mobile).
  app.post("/auth/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body ?? {});
    const presented = request.cookies[REFRESH_COOKIE] ?? body.refreshToken;
    if (!presented) {
      throw new AppError({
        statusCode: 401,
        code: "REFRESH_INVALID",
        message: "Missing refresh token",
      });
    }
    const session = await authService.rotateRefresh({ presentedToken: presented, ip: request.ip });
    return sendSession(reply, body.client, session);
  });

  // §15.7 back-office team login (email + password). A temp-password account gets
  // a change challenge (200, no tokens); a normal account gets a session.
  app.post("/auth/password/login", async (request, reply) => {
    const body = passwordLoginSchema.parse(request.body);
    const result = await authService.passwordLogin({
      email: body.email,
      password: body.password,
      ip: request.ip,
    });
    if (result.kind === "must_change_password") {
      return reply.send({ mustChangePassword: true });
    }
    return sendSession(reply, body.client, result.session);
  });

  // Set a new password with the current one (forced first-login change + rotations).
  app.post("/auth/password/change", async (request, reply) => {
    const body = passwordChangeSchema.parse(request.body);
    const session = await authService.changePassword({
      email: body.email,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      ip: request.ip,
    });
    return sendSession(reply, body.client, session);
  });

  // Revoke the session.
  app.post("/auth/logout", async (request, reply) => {
    const body = logoutSchema.parse(request.body ?? {});
    const presented = request.cookies[REFRESH_COOKIE] ?? body.refreshToken;
    await authService.logout({ presentedToken: presented, ip: request.ip });
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return reply.status(204).send();
  });
};
