import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { cmsService } from "./cms.service.js";
import {
  blogPostInputSchema,
  blogPostUpdateSchema,
  cmsIdParamSchema,
  cmsListQuerySchema,
  faqInputSchema,
  faqUpdateSchema,
  homepageOrderSchema,
  landingPageInputSchema,
  landingPageParamSchema,
  landingPageUpdateSchema,
  slugParamSchema,
  testimonialInputSchema,
  testimonialUpdateSchema,
} from "./cms.schema.js";

/**
 * CMS + SEO routes (PRD §7.11). Two surfaces: PUBLIC content reads (no auth, used
 * by the marketing site) that return PUBLISHED items only, and ADMIN-only write
 * management (default-deny) where every mutation is audited by the service.
 */
export const cmsRoutes: FastifyPluginAsync = async (app) => {
  // ---- Public content reads (published only) ----
  app.get("/content/blog", async () => ({ items: await cmsService.publicBlog() }));
  app.get("/content/blog/:slug", async (request) => {
    const { slug } = slugParamSchema.parse(request.params);
    return { post: await cmsService.publicBlogBySlug(slug) };
  });
  app.get("/content/faqs", async () => ({ items: await cmsService.publicFaqs() }));
  app.get("/content/testimonials", async () => ({ items: await cmsService.publicTestimonials() }));
  app.get("/content/landing/:kind/:slug", async (request) => {
    const { kind, slug } = landingPageParamSchema.parse(request.params);
    return { page: await cmsService.publicLanding(kind, slug) };
  });
  app.get("/content/homepage", async () => ({ items: await cmsService.getHomepage() }));

  // ---- Admin management (ADMIN-only, audited) ----
  await app.register(async (admin) => {
    admin.addHook("preHandler", admin.authenticate);
    admin.addHook("preHandler", admin.requireRole("ADMIN"));

    // Blog
    admin.get("/admin/cms/blog", async (request) => cmsService.listBlog(cmsListQuerySchema.parse(request.query)));
    admin.post("/admin/cms/blog", async (request, reply) => {
      const actor = getAuthUser(request);
      const body = blogPostInputSchema.parse(request.body);
      return reply.status(201).send({ post: await cmsService.createBlog(actor, body, request.ip) });
    });
    admin.patch("/admin/cms/blog/:id", async (request) => {
      const actor = getAuthUser(request);
      const { id } = cmsIdParamSchema.parse(request.params);
      const body = blogPostUpdateSchema.parse(request.body);
      return { post: await cmsService.updateBlog(actor, id, body, request.ip) };
    });
    admin.delete("/admin/cms/blog/:id", async (request, reply) => {
      const actor = getAuthUser(request);
      const { id } = cmsIdParamSchema.parse(request.params);
      await cmsService.deleteBlog(actor, id, request.ip);
      return reply.status(204).send();
    });

    // FAQs
    admin.get("/admin/cms/faqs", async () => ({ items: await cmsService.listFaqs() }));
    admin.post("/admin/cms/faqs", async (request, reply) => {
      const actor = getAuthUser(request);
      const body = faqInputSchema.parse(request.body);
      return reply.status(201).send({ faq: await cmsService.createFaq(actor, body, request.ip) });
    });
    admin.patch("/admin/cms/faqs/:id", async (request) => {
      const actor = getAuthUser(request);
      const { id } = cmsIdParamSchema.parse(request.params);
      const body = faqUpdateSchema.parse(request.body);
      return { faq: await cmsService.updateFaq(actor, id, body, request.ip) };
    });
    admin.delete("/admin/cms/faqs/:id", async (request, reply) => {
      const actor = getAuthUser(request);
      const { id } = cmsIdParamSchema.parse(request.params);
      await cmsService.deleteFaq(actor, id, request.ip);
      return reply.status(204).send();
    });

    // Testimonials
    admin.get("/admin/cms/testimonials", async () => ({ items: await cmsService.listTestimonials() }));
    admin.post("/admin/cms/testimonials", async (request, reply) => {
      const actor = getAuthUser(request);
      const body = testimonialInputSchema.parse(request.body);
      return reply.status(201).send({ testimonial: await cmsService.createTestimonial(actor, body, request.ip) });
    });
    admin.patch("/admin/cms/testimonials/:id", async (request) => {
      const actor = getAuthUser(request);
      const { id } = cmsIdParamSchema.parse(request.params);
      const body = testimonialUpdateSchema.parse(request.body);
      return { testimonial: await cmsService.updateTestimonial(actor, id, body, request.ip) };
    });
    admin.delete("/admin/cms/testimonials/:id", async (request, reply) => {
      const actor = getAuthUser(request);
      const { id } = cmsIdParamSchema.parse(request.params);
      await cmsService.deleteTestimonial(actor, id, request.ip);
      return reply.status(204).send();
    });

    // Landing pages
    admin.get("/admin/cms/landing", async (request) => cmsService.listLanding(cmsListQuerySchema.parse(request.query)));
    admin.post("/admin/cms/landing", async (request, reply) => {
      const actor = getAuthUser(request);
      const body = landingPageInputSchema.parse(request.body);
      return reply.status(201).send({ page: await cmsService.createLanding(actor, body, request.ip) });
    });
    admin.patch("/admin/cms/landing/:id", async (request) => {
      const actor = getAuthUser(request);
      const { id } = cmsIdParamSchema.parse(request.params);
      const body = landingPageUpdateSchema.parse(request.body);
      return { page: await cmsService.updateLanding(actor, id, body, request.ip) };
    });
    admin.delete("/admin/cms/landing/:id", async (request, reply) => {
      const actor = getAuthUser(request);
      const { id } = cmsIdParamSchema.parse(request.params);
      await cmsService.deleteLanding(actor, id, request.ip);
      return reply.status(204).send();
    });

    // Homepage featured order
    admin.put("/admin/cms/homepage", async (request) => {
      const actor = getAuthUser(request);
      const body = homepageOrderSchema.parse(request.body);
      return { items: await cmsService.setHomepage(actor, body, request.ip) };
    });
  });
};
