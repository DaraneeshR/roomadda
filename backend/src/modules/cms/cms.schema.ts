/**
 * CMS-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); re-exported under the route's local names.
 */
export {
  blogPostInputSchema,
  blogPostUpdateSchema,
  faqInputSchema,
  faqUpdateSchema,
  testimonialInputSchema,
  testimonialUpdateSchema,
  landingPageInputSchema,
  landingPageUpdateSchema,
  homepageOrderSchema,
  cmsListQuerySchema,
  slugParamSchema,
  landingPageParamSchema,
  uuidParamSchema as cmsIdParamSchema,
} from "@roomadda/shared";

export type {
  BlogPostInput,
  BlogPostUpdateInput,
  FaqInput,
  FaqUpdateInput,
  TestimonialInput,
  TestimonialUpdateInput,
  LandingPageInput,
  LandingPageUpdateInput,
  HomepageOrderInput,
  CmsListQuery,
} from "@roomadda/shared";
