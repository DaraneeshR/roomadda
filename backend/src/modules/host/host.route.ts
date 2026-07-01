import type { FastifyPluginAsync } from "fastify";
import { hostListingRoutes } from "./host-listing.route.js";
import { bookingRequestRoutes } from "./booking-request.route.js";
import { walkInRoutes } from "./walkin.route.js";
import { rosterRoutes } from "./roster.route.js";
import { hostMenuRoutes } from "./host-menu.route.js";
import { hostServiceRoutes } from "./host-service.route.js";
import { broadcastRoutes } from "./broadcast.route.js";
import { revenueRoutes } from "./revenue.route.js";

/**
 * Host surface — every endpoint the host mobile app AND the web host portal
 * consume, built once on the backend. All sub-routes are HOST/ADMIN (default-deny)
 * and ownership-scoped (a host only ever touches their OWN listings/tenants/menus;
 * tenant KYC is never exposed). Registered under the /v1 prefix by app.ts.
 */
export const hostRoutes: FastifyPluginAsync = async (app) => {
  await app.register(hostListingRoutes);
  await app.register(bookingRequestRoutes);
  await app.register(walkInRoutes);
  await app.register(rosterRoutes);
  await app.register(hostMenuRoutes);
  await app.register(hostServiceRoutes);
  await app.register(broadcastRoutes);
  await app.register(revenueRoutes);
};
