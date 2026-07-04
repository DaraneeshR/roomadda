import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { logger } from "./lib/logger.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { securityPlugin } from "./plugins/security.js";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./modules/health/health.route.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { userRoutes } from "./modules/users/users.route.js";
import { listingRoutes } from "./modules/listing/listing.route.js";
import { areaRoutes } from "./modules/area/area.route.js";
import { bookingRoutes } from "./modules/booking/booking.route.js";
import { stayRoutes } from "./modules/stay/stay.route.js";
import { rentRoutes } from "./modules/rent/rent.route.js";
import { mealMenuRoutes } from "./modules/menu/menu.route.js";
import { serviceRequestRoutes } from "./modules/service-request/service-request.route.js";
import { leaveNoticeRoutes } from "./modules/leave-notice/leave-notice.route.js";
import { safetyRoutes } from "./modules/safety/safety.route.js";
import { chatRoutes } from "./modules/chat/chat.route.js";
import { deviceRoutes } from "./modules/devices/devices.route.js";
import { kycRoutes } from "./modules/kyc/kyc.route.js";
import { wishlistRoutes } from "./modules/wishlist/wishlist.route.js";
import { reviewRoutes } from "./modules/review/review.route.js";
import { socialRoutes } from "./modules/social/social.route.js";
import { badgeAdminRoutes } from "./modules/badge/badge.route.js";
import { webhookRoutes } from "./modules/booking/webhook.route.js";
import { cashRoutes } from "./modules/booking/cash.route.js";
import { adRoutes } from "./modules/ad/ad.route.js";
import { adminRoutes } from "./modules/admin/admin.route.js";
import { metricsRoutes } from "./modules/metrics/metrics.route.js";
import { roomieRoutes } from "./modules/roomie/roomie.route.js";
import { hostRoutes } from "./modules/host/host.route.js";
import { agentRoutes } from "./modules/agent/agent.route.js";
import { cmsRoutes } from "./modules/cms/cms.route.js";
import { broadcastRoutes } from "./modules/notification/broadcast.route.js";
import { erpRoutes } from "./modules/erp/erp.route.js";

/** 1 MB request body cap. */
const BODY_LIMIT_BYTES = 1_048_576;

/**
 * Build the Fastify application: logging, request ids, the 1 MB body limit,
 * the global error handler, security plugins, then routes. Pure construction —
 * no listening — so tests can build an app without binding a port.
 */
export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: BODY_LIMIT_BYTES,
    // Respect X-Forwarded-* behind the load balancer so req.ip (rate-limit key)
    // and protocol are correct.
    trustProxy: true,
    // Honour an inbound x-request-id (trace propagation) or mint a new one.
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      return typeof header === "string" && header.length > 0 ? header : randomUUID();
    },
  });

  // Error handling first so it wraps everything registered after it.
  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin);
  await app.register(cookie); // parses/sets cookies (refresh token for web clients)
  await app.register(authPlugin); // decorates authenticate / requireRole / requireKyc

  // Liveness/readiness are unversioned for orchestrators.
  await app.register(healthRoutes);

  // Versioned API surface. Feature modules register here as they are built.
  await app.register(
    async (v1) => {
      v1.get("/", async () => ({ service: "roomadda-api", version: "v1" }));
      await v1.register(authRoutes);
      await v1.register(userRoutes);
      await v1.register(listingRoutes);
      await v1.register(areaRoutes);
      await v1.register(bookingRoutes);
      await v1.register(stayRoutes);
      await v1.register(rentRoutes);
      await v1.register(mealMenuRoutes);
      await v1.register(serviceRequestRoutes);
      await v1.register(leaveNoticeRoutes);
      await v1.register(safetyRoutes);
      await v1.register(chatRoutes);
      await v1.register(deviceRoutes);
      await v1.register(kycRoutes);
      await v1.register(wishlistRoutes);
      await v1.register(reviewRoutes);
      await v1.register(socialRoutes);
      await v1.register(badgeAdminRoutes);
      await v1.register(cashRoutes);
      await v1.register(adRoutes);
      await v1.register(adminRoutes);
      await v1.register(metricsRoutes);
      await v1.register(roomieRoutes);
      await v1.register(hostRoutes);
      await v1.register(agentRoutes);
      await v1.register(cmsRoutes);
      await v1.register(broadcastRoutes);
      await v1.register(erpRoutes);
      // Encapsulated: webhook gets its own raw-body parser, scoped to this child.
      await v1.register(webhookRoutes);
    },
    { prefix: "/v1" },
  );

  return app;
}
