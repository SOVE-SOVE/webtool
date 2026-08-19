import type { ComponentType } from "react";
import type { PageType, SectionType, SiteSection } from "@/types";

import { Navigation } from "@/sections/Navigation";
import { Hero } from "@/sections/Hero";
import { Cta } from "@/sections/Cta";
import { ServiceCards } from "@/sections/ServiceCards";
import { Features } from "@/sections/Features";
import { Testimonials } from "@/sections/Testimonials";
import { Pricing } from "@/sections/Pricing";
import { Faq } from "@/sections/Faq";
import { Contact } from "@/sections/Contact";
import { ImageContentSplit } from "@/sections/ImageContentSplit";
import { Gallery } from "@/sections/Gallery";
import { Footer } from "@/sections/Footer";
import { FormSection } from "@/sections/FormSection";
import { Stats } from "@/sections/Stats";
import { Logos } from "@/sections/Logos";
import { Team } from "@/sections/Team";
import { Portfolio } from "@/sections/Portfolio";

export type SectionRegistryEntry<T extends SiteSection = SiteSection> = {
  type: T["type"];
  label: string;
  description: string;
  component: ComponentType<T>;
  /** Sitemap PageTypes (apps/api's sitemaps.models.PageType) this
   * section is a sensible fit for — the generator's starting point for
   * "what can go on this page", not a hard restriction. */
  pageTypes: PageType[];
  /** Config keys the generator must have real content for before using
   * this section — see validateSection in validate.ts. */
  requiredFields: string[];
  /** True for sections that appear once per page (Navigation, Footer)
   * rather than being chosen per content block. */
  structural?: boolean;
};

// Cast is required because SECTION_REGISTRY's value type is intentionally
// invariant per key (each entry's component matches its own config type)
// while the Record is indexed by the union — TypeScript can't express
// "the entry for key K has type SectionRegistryEntry<Extract<SiteSection, {type: K}>>"
// as a plain Record literal without this.
export const SECTION_REGISTRY: { [K in SectionType]: SectionRegistryEntry<Extract<SiteSection, { type: K }>> } = {
  navigation: {
    type: "navigation",
    label: "Navigation",
    description: "Primary site header with logo, links, and an optional CTA.",
    component: Navigation,
    pageTypes: ["home", "about", "services", "service_detail", "products", "product_detail", "contact", "faq", "testimonials", "portfolio", "blog", "blog_post", "custom"],
    requiredFields: ["logo", "links"],
    structural: true,
  },
  hero: {
    type: "hero",
    label: "Hero",
    description: "The page's opening statement — one heading, one clear action.",
    component: Hero,
    pageTypes: ["home", "about", "services", "service_detail", "products", "product_detail", "portfolio", "blog"],
    requiredFields: ["heading"],
  },
  cta: {
    type: "cta",
    label: "Call to action",
    description: "A focused prompt to take the next step, usually mid- or end-of-page.",
    component: Cta,
    pageTypes: ["home", "about", "services", "service_detail", "products", "product_detail", "portfolio", "blog", "blog_post"],
    requiredFields: ["heading", "primaryCta"],
  },
  serviceCards: {
    type: "serviceCards",
    label: "Service cards",
    description: "A grid summarizing distinct services offered.",
    component: ServiceCards,
    pageTypes: ["home", "services"],
    requiredFields: ["services"],
  },
  features: {
    type: "features",
    label: "Feature section",
    description: "Highlights specific product/offering capabilities or benefits.",
    component: Features,
    pageTypes: ["home", "products", "product_detail", "service_detail"],
    requiredFields: ["features"],
  },
  testimonials: {
    type: "testimonials",
    label: "Testimonials",
    description: "Real client quotes — never generated or invented.",
    component: Testimonials,
    pageTypes: ["home", "about", "testimonials"],
    requiredFields: ["testimonials"],
  },
  pricing: {
    type: "pricing",
    label: "Pricing",
    description: "Package/tier comparison with real prices.",
    component: Pricing,
    pageTypes: ["home", "services", "products"],
    requiredFields: ["tiers"],
  },
  faq: {
    type: "faq",
    label: "FAQ",
    description: "Common questions answered with real, specific information.",
    component: Faq,
    pageTypes: ["home", "faq", "services", "products"],
    requiredFields: ["items"],
  },
  contact: {
    type: "contact",
    label: "Contact",
    description: "Contact details and/or an inquiry form.",
    component: Contact,
    pageTypes: ["contact", "home"],
    requiredFields: ["details"],
  },
  imageContentSplit: {
    type: "imageContentSplit",
    label: "Image + content split",
    description: "A single image paired with a focused block of copy.",
    component: ImageContentSplit,
    pageTypes: ["home", "about", "services", "service_detail", "products", "product_detail"],
    requiredFields: ["heading", "body", "media"],
  },
  gallery: {
    type: "gallery",
    label: "Gallery",
    description: "A grid of real photos — every image needs genuine alt text.",
    component: Gallery,
    pageTypes: ["portfolio", "about", "products"],
    requiredFields: ["images"],
  },
  footer: {
    type: "footer",
    label: "Footer",
    description: "Site-wide footer with links, contact info, and legal.",
    component: Footer,
    pageTypes: ["home", "about", "services", "service_detail", "products", "product_detail", "contact", "faq", "testimonials", "portfolio", "blog", "blog_post", "custom"],
    requiredFields: ["copyrightHolder"],
    structural: true,
  },
  form: {
    type: "form",
    label: "Form",
    description: "A standalone form (newsletter, quote request, booking).",
    component: FormSection,
    pageTypes: ["contact", "home", "custom"],
    requiredFields: ["form"],
  },
  stats: {
    type: "stats",
    label: "Stats",
    description: "Real, sourced figures — never computed or guessed.",
    component: Stats,
    pageTypes: ["home", "about"],
    requiredFields: ["stats"],
  },
  logos: {
    type: "logos",
    label: "Logo strip",
    description: "Client/partner/press logos as social proof.",
    component: Logos,
    pageTypes: ["home", "about"],
    requiredFields: ["logos"],
  },
  team: {
    type: "team",
    label: "Team",
    description: "Real people, real roles — never a placeholder headshot.",
    component: Team,
    pageTypes: ["about", "home"],
    requiredFields: ["members"],
  },
  portfolio: {
    type: "portfolio",
    label: "Portfolio",
    description: "Case studies / past work with real project details.",
    component: Portfolio,
    pageTypes: ["portfolio", "home"],
    requiredFields: ["projects"],
  },
};

export const SECTION_TYPES = Object.keys(SECTION_REGISTRY) as SectionType[];

/** Erased view of a registry entry for cross-cutting lookups that span
 * every section type at once — component prop types are necessarily
 * incompatible across the union (contravariance), so callers that just
 * need metadata (label/pageTypes/requiredFields) use this instead of
 * the precisely-typed per-key SectionRegistryEntry<T>. */
export type AnySectionRegistryEntry = Omit<SectionRegistryEntry<SiteSection>, "component"> & {
  component: ComponentType<never>;
};

const ALL_ENTRIES = Object.values(SECTION_REGISTRY) as unknown as AnySectionRegistryEntry[];

/** Sections that are plausible fits for a given sitemap page type,
 * excluding structural ones (nav/footer) that the page layout handles
 * separately rather than picking per content block. */
export function getSectionsForPageType(pageType: PageType): AnySectionRegistryEntry[] {
  return ALL_ENTRIES.filter((entry) => !entry.structural && entry.pageTypes.includes(pageType));
}

export function getSectionEntry<K extends SectionType>(type: K): SectionRegistryEntry<Extract<SiteSection, { type: K }>> {
  return SECTION_REGISTRY[type];
}
