import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { reviewService } from "./review.service.js";
import { toReview } from "./serializer.js";
import {
  createReviewSchema,
  hostReviewResponseSchema,
  listReviewsQuerySchema,
  listingIdParamSchema,
  reviewIdParamSchema,
} from "./review.schema.js";

/**
 * Reviews & ratings routes. Public READ; TENANT-gated WRITE (only from an
 * eligible stay); HOST-gated response (only on a listing they own). Every write
 * declares its role (default-deny, see /CLAUDE.md); the fine-grained eligibility
 * / ownership checks live in the service.
 */
export const reviewRoutes: FastifyPluginAsync = async (app) => {
  // Public: a listing's reviews (newest first, cursor-paginated) + aggregate.
  app.get("/listings/:id/reviews", async (request) => {
    const { id } = listingIdParamSchema.parse(request.params);
    const query = listReviewsQuerySchema.parse(request.query);
    const { page, summary } = await reviewService.listForListing(id, query);
    return { items: page.items.map(toReview), nextCursor: page.nextCursor, summary };
  });

  // TENANT: write a review from an eligible stay on this listing (one per booking).
  app.post(
    "/listings/:id/reviews",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = listingIdParamSchema.parse(request.params);
      const body = createReviewSchema.parse(request.body);
      const review = await reviewService.create(user.id, id, body);
      return reply.status(201).send({ review: toReview(review) });
    },
  );

  // HOST: reply to a review — only on a listing the caller owns.
  app.post(
    "/reviews/:id/response",
    { preHandler: [app.authenticate, app.requireRole("HOST")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = reviewIdParamSchema.parse(request.params);
      const { text } = hostReviewResponseSchema.parse(request.body);
      const review = await reviewService.respond(id, user.id, text);
      return reply.send({ review: toReview(review) });
    },
  );
};
