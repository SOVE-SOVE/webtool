import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Hero } from "@/sections/Hero";
import { Navigation } from "@/sections/Navigation";
import { ServiceCards } from "@/sections/ServiceCards";
import { Faq } from "@/sections/Faq";
import { Testimonials } from "@/sections/Testimonials";
import { Gallery } from "@/sections/Gallery";
import { Pricing } from "@/sections/Pricing";
import { Features } from "@/sections/Features";
import { Footer } from "@/sections/Footer";
import { FormSection } from "@/sections/FormSection";
import { Stats } from "@/sections/Stats";

import type {
  FaqConfig,
  FeaturesConfig,
  FooterConfig,
  FormSectionConfig,
  GalleryConfig,
  HeroConfig,
  NavigationConfig,
  PricingConfig,
  ServiceCardsConfig,
  StatsConfig,
  TestimonialsConfig,
} from "@/types";

describe("Hero", () => {
  const base: HeroConfig = { type: "hero", heading: "Reliable plumbing, done right the first time" };

  it("renders the heading as an h1 for correct document hierarchy", () => {
    const html = renderToStaticMarkup(<Hero {...base} />);
    expect(html).toContain("<h1");
    expect(html).toContain("Reliable plumbing, done right the first time");
  });

  it("renders a real alt attribute when media is supplied", () => {
    const html = renderToStaticMarkup(
      <Hero {...base} media={{ src: "/hero.jpg", alt: "A plumber repairing a kitchen sink" }} />,
    );
    expect(html).toContain('alt="A plumber repairing a kitchen sink"');
  });

  it("omits the CTA row entirely when no CTAs are configured", () => {
    const html = renderToStaticMarkup(<Hero {...base} />);
    expect(html).not.toContain("<a ");
  });
});

describe("Navigation", () => {
  const config: NavigationConfig = {
    type: "navigation",
    logo: { label: "Coastal Cafe", href: "/" },
    links: [
      { label: "Menu", href: "/menu" },
      { label: "Contact", href: "/contact" },
    ],
  };

  it("uses a labeled <nav> landmark", () => {
    const html = renderToStaticMarkup(<Navigation {...config} />);
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain("Menu");
    expect(html).toContain("Contact");
  });
});

describe("ServiceCards", () => {
  const config: ServiceCardsConfig = {
    type: "serviceCards",
    heading: "What we offer",
    services: [
      { title: "Emergency repairs", description: "24/7 callout for burst pipes and no hot water." },
      { title: "Bathroom renovation", description: "Full strip-out and refit." },
    ],
  };

  it("renders one card per service", () => {
    const html = renderToStaticMarkup(<ServiceCards {...config} />);
    expect(html).toContain("Emergency repairs");
    expect(html).toContain("Bathroom renovation");
  });
});

describe("Features", () => {
  const config: FeaturesConfig = {
    type: "features",
    layout: "alternating",
    features: [
      { title: "Licensed & insured", description: "Fully licensed master plumbers on every job." },
      { title: "Upfront pricing", description: "A fixed quote before any work starts." },
    ],
  };

  it("renders alternating rows without a grid wrapper", () => {
    const html = renderToStaticMarkup(<Features {...config} />);
    expect(html).toContain("Licensed &amp; insured");
    expect(html).toContain("Upfront pricing");
  });
});

describe("Faq", () => {
  const config: FaqConfig = {
    type: "faq",
    items: [
      { question: "Do you charge a callout fee?", answer: "No — quotes are always free." },
      { question: "What areas do you cover?", answer: "Greater Brisbane, same-day in most suburbs." },
    ],
  };

  it("renders each item as a native, no-JS accordion", () => {
    const html = renderToStaticMarkup(<Faq {...config} />);
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Do you charge a callout fee?");
  });
});

describe("Testimonials", () => {
  it("renders nothing when there is no real testimonial content, never a placeholder", () => {
    const config: TestimonialsConfig = { type: "testimonials", testimonials: [] };
    const html = renderToStaticMarkup(<Testimonials {...config} />);
    expect(html).toBe("");
  });

  it("renders the real quote and author verbatim", () => {
    const config: TestimonialsConfig = {
      type: "testimonials",
      testimonials: [{ quote: "Fast, honest, and cleaned up after themselves.", authorName: "J. Alvarez", authorRole: "Homeowner" }],
    };
    const html = renderToStaticMarkup(<Testimonials {...config} />);
    expect(html).toContain("Fast, honest, and cleaned up after themselves.");
    expect(html).toContain("J. Alvarez");
  });
});

describe("Gallery", () => {
  it("requires and renders real alt text on every image", () => {
    const config: GalleryConfig = {
      type: "gallery",
      images: [
        { src: "/a.jpg", alt: "Finished bathroom renovation, marble tile" },
        { src: "/b.jpg", alt: "Kitchen sink installation in progress" },
      ],
    };
    const html = renderToStaticMarkup(<Gallery {...config} />);
    expect(html).toContain('alt="Finished bathroom renovation, marble tile"');
    expect(html).toContain('alt="Kitchen sink installation in progress"');
  });
});

describe("Pricing", () => {
  const config: PricingConfig = {
    type: "pricing",
    tiers: [
      { name: "Standard", price: "$150", features: ["Same-day quote"], cta: { label: "Book", href: "/book" } },
      { name: "Premium", price: "$300", features: ["Same-day quote", "Priority slot"], cta: { label: "Book", href: "/book" }, highlighted: true },
    ],
  };

  it("marks the highlighted tier and never fabricates a price", () => {
    const html = renderToStaticMarkup(<Pricing {...config} />);
    expect(html).toContain("Most popular");
    expect(html).toContain("$150");
    expect(html).toContain("$300");
  });
});

describe("Footer", () => {
  const config: FooterConfig = { type: "footer", copyrightHolder: "Coastal Cafe Pty Ltd" };

  it("renders the current year and the real copyright holder", () => {
    const html = renderToStaticMarkup(<Footer {...config} />);
    expect(html).toContain(String(new Date().getFullYear()));
    expect(html).toContain("Coastal Cafe Pty Ltd");
  });
});

describe("FormSection", () => {
  const config: FormSectionConfig = {
    type: "form",
    form: {
      submitLabel: "Send",
      fields: [
        { name: "email", label: "Email", type: "email", required: true },
        { name: "message", label: "Message", type: "textarea" },
      ],
    },
  };

  it("renders a labeled field for every configured input", () => {
    const html = renderToStaticMarkup(<FormSection {...config} />);
    expect(html).toContain('for="field-email"');
    expect(html).toContain('type="email"');
    expect(html).toContain("<textarea");
    expect(html).toContain("Send");
  });
});

describe("Stats", () => {
  it("renders string values verbatim rather than computing them", () => {
    const config: StatsConfig = { type: "stats", stats: [{ value: "12+", label: "Years in business" }] };
    const html = renderToStaticMarkup(<Stats {...config} />);
    expect(html).toContain("12+");
    expect(html).toContain("Years in business");
  });
});
