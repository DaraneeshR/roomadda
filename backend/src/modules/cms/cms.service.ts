import { Prisma, type BlogPost, type Faq, type LandingPage, type Testimonial } from "@prisma/client";
import type {
  BlogPostDTO,
  BlogPostInput,
  BlogPostUpdateInput,
  CmsListQuery,
  FaqDTO,
  FaqInput,
  FaqUpdateInput,
  HomepageFeatureDTO,
  HomepageOrderInput,
  LandingPageDTO,
  LandingPageInput,
  LandingPageKind,
  LandingPageUpdateInput,
  TestimonialDTO,
  TestimonialInput,
  TestimonialUpdateInput,
} from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { toPage, type Page } from "../../lib/pagination.js";

/**
 * CMS + SEO content (PRD §7.11). Admins manage blog posts, FAQs, testimonials,
 * city/area/intent/landmark landing copy + per-page meta, and the homepage
 * "featured" ordering — no code deploy required. Every mutation is ADMIN-only at
 * the route and audited here. Public read helpers return PUBLISHED content only.
 */

type Actor = { id: string };

const conflict = (message: string): AppError => new AppError({ statusCode: 409, code: "SLUG_TAKEN", message });
const notFound = (what: string): AppError =>
  new AppError({ statusCode: 404, code: "NOT_FOUND", message: `${what} not found` });

// ---- serializers ----------------------------------------------------------
function toBlog(b: BlogPost): BlogPostDTO {
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    metaTitle: b.metaTitle,
    metaDescription: b.metaDescription,
    excerpt: b.excerpt,
    body: b.body,
    published: b.published,
    publishedAt: b.publishedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function toFaq(f: Faq): FaqDTO {
  return {
    id: f.id,
    question: f.question,
    answer: f.answer,
    category: f.category,
    sortOrder: f.sortOrder,
    published: f.published,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

function toTestimonial(t: Testimonial): TestimonialDTO {
  return {
    id: t.id,
    authorName: t.authorName,
    authorRole: t.authorRole,
    quote: t.quote,
    avatarUrl: t.avatarUrl,
    sortOrder: t.sortOrder,
    published: t.published,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toLanding(l: LandingPage): LandingPageDTO {
  return {
    id: l.id,
    kind: l.kind,
    slug: l.slug,
    heading: l.heading,
    bodyCopy: l.bodyCopy,
    metaTitle: l.metaTitle,
    metaDescription: l.metaDescription,
    ogImageUrl: l.ogImageUrl,
    keywords: l.keywords,
    published: l.published,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

/** Map a Prisma unique-violation to a typed 409; rethrow anything else. */
function asConflict<T>(p: Promise<T>, message: string): Promise<T> {
  return p.catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict(message);
    throw err;
  });
}

export const cmsService = {
  // ---- Blog ---------------------------------------------------------------
  async listBlog(query: CmsListQuery): Promise<Page<BlogPostDTO>> {
    const rows = await prisma.blogPost.findMany({
      where: query.published === undefined ? {} : { published: query.published },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toBlog), nextCursor: page.nextCursor };
  },

  async createBlog(actor: Actor, input: BlogPostInput, ip?: string): Promise<BlogPostDTO> {
    const post = await asConflict(
      prisma.blogPost.create({
        data: {
          slug: input.slug,
          title: input.title,
          metaTitle: input.metaTitle ?? null,
          metaDescription: input.metaDescription ?? null,
          excerpt: input.excerpt ?? null,
          body: input.body ?? "",
          published: input.published ?? false,
          publishedAt: input.published ? new Date() : null,
          createdById: actor.id,
        },
      }),
      "A blog post with this slug already exists",
    );
    await writeAudit({ actorId: actor.id, action: "cms.blog.created", targetId: post.id, ip, metadata: { slug: post.slug } });
    return toBlog(post);
  },

  async updateBlog(actor: Actor, id: string, input: BlogPostUpdateInput, ip?: string): Promise<BlogPostDTO> {
    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw notFound("Blog post");
    // Stamp publishedAt the first time it goes live.
    const publishedAt =
      input.published === true && !existing.published ? new Date() : input.published === false ? null : undefined;
    const post = await prisma.blogPost.update({
      where: { id },
      data: {
        title: input.title,
        metaTitle: input.metaTitle,
        metaDescription: input.metaDescription,
        excerpt: input.excerpt,
        body: input.body,
        published: input.published,
        ...(publishedAt !== undefined ? { publishedAt } : {}),
      },
    });
    await writeAudit({ actorId: actor.id, action: "cms.blog.updated", targetId: id, ip, metadata: { fields: Object.keys(input) } });
    return toBlog(post);
  },

  async deleteBlog(actor: Actor, id: string, ip?: string): Promise<void> {
    const existing = await prisma.blogPost.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("Blog post");
    await prisma.blogPost.delete({ where: { id } });
    await writeAudit({ actorId: actor.id, action: "cms.blog.deleted", targetId: id, ip });
  },

  async publicBlog(): Promise<BlogPostDTO[]> {
    const rows = await prisma.blogPost.findMany({ where: { published: true }, orderBy: { publishedAt: "desc" }, take: 100 });
    return rows.map(toBlog);
  },

  async publicBlogBySlug(slug: string): Promise<BlogPostDTO> {
    const post = await prisma.blogPost.findFirst({ where: { slug, published: true } });
    if (!post) throw notFound("Blog post");
    return toBlog(post);
  },

  // ---- FAQ ----------------------------------------------------------------
  async listFaqs(): Promise<FaqDTO[]> {
    const rows = await prisma.faq.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return rows.map(toFaq);
  },

  async createFaq(actor: Actor, input: FaqInput, ip?: string): Promise<FaqDTO> {
    const faq = await prisma.faq.create({
      data: {
        question: input.question,
        answer: input.answer,
        category: input.category ?? null,
        sortOrder: input.sortOrder ?? 0,
        published: input.published ?? true,
      },
    });
    await writeAudit({ actorId: actor.id, action: "cms.faq.created", targetId: faq.id, ip });
    return toFaq(faq);
  },

  async updateFaq(actor: Actor, id: string, input: FaqUpdateInput, ip?: string): Promise<FaqDTO> {
    const existing = await prisma.faq.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("FAQ");
    const faq = await prisma.faq.update({
      where: { id },
      data: {
        question: input.question,
        answer: input.answer,
        category: input.category,
        sortOrder: input.sortOrder,
        published: input.published,
      },
    });
    await writeAudit({ actorId: actor.id, action: "cms.faq.updated", targetId: id, ip });
    return toFaq(faq);
  },

  async deleteFaq(actor: Actor, id: string, ip?: string): Promise<void> {
    const existing = await prisma.faq.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("FAQ");
    await prisma.faq.delete({ where: { id } });
    await writeAudit({ actorId: actor.id, action: "cms.faq.deleted", targetId: id, ip });
  },

  async publicFaqs(): Promise<FaqDTO[]> {
    const rows = await prisma.faq.findMany({ where: { published: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return rows.map(toFaq);
  },

  // ---- Testimonials -------------------------------------------------------
  async listTestimonials(): Promise<TestimonialDTO[]> {
    const rows = await prisma.testimonial.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return rows.map(toTestimonial);
  },

  async createTestimonial(actor: Actor, input: TestimonialInput, ip?: string): Promise<TestimonialDTO> {
    const t = await prisma.testimonial.create({
      data: {
        authorName: input.authorName,
        authorRole: input.authorRole ?? null,
        quote: input.quote,
        avatarUrl: input.avatarUrl ?? null,
        sortOrder: input.sortOrder ?? 0,
        published: input.published ?? true,
      },
    });
    await writeAudit({ actorId: actor.id, action: "cms.testimonial.created", targetId: t.id, ip });
    return toTestimonial(t);
  },

  async updateTestimonial(actor: Actor, id: string, input: TestimonialUpdateInput, ip?: string): Promise<TestimonialDTO> {
    const existing = await prisma.testimonial.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("Testimonial");
    const t = await prisma.testimonial.update({
      where: { id },
      data: {
        authorName: input.authorName,
        authorRole: input.authorRole,
        quote: input.quote,
        avatarUrl: input.avatarUrl,
        sortOrder: input.sortOrder,
        published: input.published,
      },
    });
    await writeAudit({ actorId: actor.id, action: "cms.testimonial.updated", targetId: id, ip });
    return toTestimonial(t);
  },

  async deleteTestimonial(actor: Actor, id: string, ip?: string): Promise<void> {
    const existing = await prisma.testimonial.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("Testimonial");
    await prisma.testimonial.delete({ where: { id } });
    await writeAudit({ actorId: actor.id, action: "cms.testimonial.deleted", targetId: id, ip });
  },

  async publicTestimonials(): Promise<TestimonialDTO[]> {
    const rows = await prisma.testimonial.findMany({ where: { published: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return rows.map(toTestimonial);
  },

  // ---- Landing pages ------------------------------------------------------
  async listLanding(query: CmsListQuery): Promise<Page<LandingPageDTO>> {
    const rows = await prisma.landingPage.findMany({
      where: query.published === undefined ? {} : { published: query.published },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toLanding), nextCursor: page.nextCursor };
  },

  async createLanding(actor: Actor, input: LandingPageInput, ip?: string): Promise<LandingPageDTO> {
    const page = await asConflict(
      prisma.landingPage.create({
        data: {
          kind: input.kind,
          slug: input.slug,
          heading: input.heading,
          bodyCopy: input.bodyCopy ?? "",
          metaTitle: input.metaTitle ?? null,
          metaDescription: input.metaDescription ?? null,
          ogImageUrl: input.ogImageUrl ?? null,
          keywords: input.keywords ?? [],
          published: input.published ?? false,
          createdById: actor.id,
        },
      }),
      "A landing page with this kind + slug already exists",
    );
    await writeAudit({ actorId: actor.id, action: "cms.landing.created", targetId: page.id, ip, metadata: { kind: page.kind, slug: page.slug } });
    return toLanding(page);
  },

  async updateLanding(actor: Actor, id: string, input: LandingPageUpdateInput, ip?: string): Promise<LandingPageDTO> {
    const existing = await prisma.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("Landing page");
    const page = await prisma.landingPage.update({
      where: { id },
      data: {
        heading: input.heading,
        bodyCopy: input.bodyCopy,
        metaTitle: input.metaTitle,
        metaDescription: input.metaDescription,
        ogImageUrl: input.ogImageUrl,
        keywords: input.keywords,
        published: input.published,
      },
    });
    await writeAudit({ actorId: actor.id, action: "cms.landing.updated", targetId: id, ip, metadata: { fields: Object.keys(input) } });
    return toLanding(page);
  },

  async deleteLanding(actor: Actor, id: string, ip?: string): Promise<void> {
    const existing = await prisma.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("Landing page");
    await prisma.landingPage.delete({ where: { id } });
    await writeAudit({ actorId: actor.id, action: "cms.landing.deleted", targetId: id, ip });
  },

  async publicLanding(kind: LandingPageKind, slug: string): Promise<LandingPageDTO> {
    const page = await prisma.landingPage.findFirst({ where: { kind, slug, published: true } });
    if (!page) throw notFound("Landing page");
    return toLanding(page);
  },

  // ---- Homepage featured order --------------------------------------------
  async getHomepage(): Promise<HomepageFeatureDTO[]> {
    const rows = await prisma.homepageFeature.findMany({ orderBy: { position: "asc" } });
    const listings = await prisma.pgListing.findMany({
      where: { id: { in: rows.map((r) => r.listingId) } },
      select: { id: true, alias: true, city: true },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));
    return rows.map((r) => ({
      id: r.id,
      listingId: r.listingId,
      position: r.position,
      alias: byId.get(r.listingId)?.alias ?? null,
      city: byId.get(r.listingId)?.city ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  },

  /**
   * Replace the whole homepage ordering with `listingIds` (position = index).
   * Every id must be a real listing. Runs in one transaction (multi-row mutation).
   */
  async setHomepage(actor: Actor, input: HomepageOrderInput, ip?: string): Promise<HomepageFeatureDTO[]> {
    const unique = [...new Set(input.listingIds)];
    if (unique.length !== input.listingIds.length) {
      throw new AppError({ statusCode: 422, code: "DUPLICATE_LISTING", message: "listingIds must be unique" });
    }
    const found = await prisma.pgListing.count({ where: { id: { in: unique } } });
    if (found !== unique.length) {
      throw new AppError({ statusCode: 422, code: "LISTING_NOT_FOUND", message: "One or more listings do not exist" });
    }
    await prisma.$transaction([
      prisma.homepageFeature.deleteMany({}),
      ...(unique.length > 0
        ? [
            prisma.homepageFeature.createMany({
              data: unique.map((listingId, i) => ({ listingId, position: i, createdById: actor.id })),
            }),
          ]
        : []),
    ]);
    await writeAudit({ actorId: actor.id, action: "cms.homepage_order.set", ip, metadata: { count: unique.length } });
    return this.getHomepage();
  },
};
