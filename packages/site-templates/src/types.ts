/**
 * Shared config types for the site-templates component library. Every
 * section is a plain, JSON-serializable config object (matches the
 * `websites.config` JSON column in apps/api) rendered by one component
 * from src/sections/. No section ever fetches data or invents content —
 * everything it renders comes from its config.
 */

// alt is required, never optional: an image with no real alt text is a
// missing-content problem the generator must flag, not a silently
// decorative <img alt="">.
export type Media = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
};

export type CtaVariant = "primary" | "secondary" | "outline" | "ghost";

export type CtaLink = {
  label: string;
  href: string;
  variant?: CtaVariant;
  external?: boolean;
};

export type Tone = "light" | "muted" | "dark" | "brand";

export type Logo = {
  label: string;
  href?: string;
  image?: Media;
};

/** Mirrors apps/api's sitemaps.models.PageType values exactly, so the
 * registry can be filtered by the sitemap page a section is going on. */
export type PageType =
  | "home"
  | "about"
  | "services"
  | "service_detail"
  | "products"
  | "product_detail"
  | "contact"
  | "faq"
  | "testimonials"
  | "portfolio"
  | "blog"
  | "blog_post"
  | "custom";

export type FormFieldType = "text" | "email" | "tel" | "textarea" | "select";

export type FormField = {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  /** Required and only meaningful when type === "select". */
  options?: string[];
};

export type FormConfig = {
  fields: FormField[];
  submitLabel: string;
  /** Form submission endpoint. Left for the generator/host app to wire
   * up — this library never assumes a specific backend. */
  action?: string;
  method?: "get" | "post";
  successMessage?: string;
};

export type NavigationConfig = {
  type: "navigation";
  logo: Logo;
  links: CtaLink[];
  cta?: CtaLink;
};

// "compact" tightens a section's vertical padding, most noticeably at
// the mobile breakpoint — the knob the revision workflow (operator
// feedback like "make mobile spacing tighter") actually has available
// to act on for these two sections. Defaults to "default" (unchanged).
export type SectionSpacing = "default" | "compact";

export type HeroConfig = {
  type: "hero";
  eyebrow?: string;
  heading: string;
  subheading?: string;
  media?: Media;
  primaryCta?: CtaLink;
  secondaryCta?: CtaLink;
  align?: "left" | "center";
  tone?: Tone;
  spacing?: SectionSpacing;
};

export type CtaSectionConfig = {
  type: "cta";
  heading: string;
  body?: string;
  primaryCta: CtaLink;
  secondaryCta?: CtaLink;
  tone?: Tone;
  spacing?: SectionSpacing;
};

export type ServiceItem = {
  title: string;
  description: string;
  icon?: string;
  cta?: CtaLink;
};

export type ServiceCardsConfig = {
  type: "serviceCards";
  heading?: string;
  subheading?: string;
  services: ServiceItem[];
  tone?: Tone;
};

export type FeatureItem = {
  title: string;
  description: string;
  icon?: string;
  media?: Media;
};

export type FeaturesConfig = {
  type: "features";
  heading?: string;
  subheading?: string;
  layout?: "grid" | "alternating";
  features: FeatureItem[];
  tone?: Tone;
};

export type Testimonial = {
  quote: string;
  authorName: string;
  authorRole?: string;
  authorPhoto?: Media;
};

export type TestimonialsConfig = {
  type: "testimonials";
  heading?: string;
  testimonials: Testimonial[];
  tone?: Tone;
};

export type PricingTier = {
  name: string;
  /** Free-form: "$99/mo", "From $2,500", "Contact us" — never assume a
   * bare number, so a price that isn't known yet is never guessed. */
  price: string;
  period?: string;
  description?: string;
  features: string[];
  cta: CtaLink;
  highlighted?: boolean;
};

export type PricingConfig = {
  type: "pricing";
  heading?: string;
  subheading?: string;
  tiers: PricingTier[];
  tone?: Tone;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export type FaqConfig = {
  type: "faq";
  heading?: string;
  subheading?: string;
  items: FaqItem[];
  tone?: Tone;
};

export type ContactDetail = {
  label: string;
  value: string;
  href?: string;
};

export type ContactConfig = {
  type: "contact";
  heading?: string;
  subheading?: string;
  details: ContactDetail[];
  form?: FormConfig;
  media?: Media;
  tone?: Tone;
};

export type ImageContentSplitConfig = {
  type: "imageContentSplit";
  heading: string;
  body: string;
  media: Media;
  imagePosition?: "left" | "right";
  cta?: CtaLink;
  tone?: Tone;
};

export type GalleryConfig = {
  type: "gallery";
  heading?: string;
  subheading?: string;
  images: Media[];
  columns?: 2 | 3 | 4;
  tone?: Tone;
};

export type FooterColumn = {
  heading: string;
  links: CtaLink[];
};

export type FooterConfig = {
  type: "footer";
  logo?: Logo;
  tagline?: string;
  columns?: FooterColumn[];
  socialLinks?: CtaLink[];
  contact?: { email?: string; phone?: string; address?: string };
  legalLinks?: CtaLink[];
  copyrightHolder: string;
};

export type FormSectionConfig = {
  type: "form";
  heading?: string;
  subheading?: string;
  form: FormConfig;
  tone?: Tone;
};

export type StatItem = {
  /** String, not number — real reported figures ("10+ years",
   * "4 states") without forcing false numeric precision. */
  value: string;
  label: string;
};

export type StatsConfig = {
  type: "stats";
  heading?: string;
  stats: StatItem[];
  tone?: Tone;
};

export type LogosConfig = {
  type: "logos";
  heading?: string;
  logos: Media[];
  tone?: Tone;
};

export type TeamMember = {
  name: string;
  role: string;
  photo?: Media;
  bio?: string;
};

export type TeamConfig = {
  type: "team";
  heading?: string;
  subheading?: string;
  members: TeamMember[];
  tone?: Tone;
};

export type PortfolioItem = {
  title: string;
  category?: string;
  media: Media;
  href?: string;
  description?: string;
};

export type PortfolioConfig = {
  type: "portfolio";
  heading?: string;
  subheading?: string;
  projects: PortfolioItem[];
  tone?: Tone;
};

export type SiteSection =
  | NavigationConfig
  | HeroConfig
  | CtaSectionConfig
  | ServiceCardsConfig
  | FeaturesConfig
  | TestimonialsConfig
  | PricingConfig
  | FaqConfig
  | ContactConfig
  | ImageContentSplitConfig
  | GalleryConfig
  | FooterConfig
  | FormSectionConfig
  | StatsConfig
  | LogosConfig
  | TeamConfig
  | PortfolioConfig;

export type SectionType = SiteSection["type"];
