import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Cta } from "@/sections/Cta";
import { Contact } from "@/sections/Contact";
import { ImageContentSplit } from "@/sections/ImageContentSplit";
import { Logos } from "@/sections/Logos";
import { Team } from "@/sections/Team";
import { Portfolio } from "@/sections/Portfolio";

import type {
  ContactConfig,
  CtaSectionConfig,
  ImageContentSplitConfig,
  LogosConfig,
  PortfolioConfig,
  TeamConfig,
} from "@/types";

describe("Cta", () => {
  it("renders exactly one primary action plus an optional secondary", () => {
    const config: CtaSectionConfig = {
      type: "cta",
      heading: "Ready to get your quote?",
      primaryCta: { label: "Request a quote", href: "/contact" },
    };
    const html = renderToStaticMarkup(<Cta {...config} />);
    expect(html).toContain("Request a quote");
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });

  it("tightens padding when spacing is 'compact'", () => {
    const config: CtaSectionConfig = {
      type: "cta",
      heading: "Ready to get your quote?",
      primaryCta: { label: "Request a quote", href: "/contact" },
      spacing: "compact",
    };
    const html = renderToStaticMarkup(<Cta {...config} />);
    expect(html).toContain("sm:py-12");
    expect(html).not.toContain("sm:py-20");
  });
});

describe("Contact", () => {
  it("renders real contact details as a definition list, form fields when supplied", () => {
    const config: ContactConfig = {
      type: "contact",
      details: [{ label: "Phone", value: "(07) 5555 0199", href: "tel:0755550199" }],
      form: { submitLabel: "Send message", fields: [{ name: "email", label: "Email", type: "email", required: true }] },
    };
    const html = renderToStaticMarkup(<Contact {...config} />);
    expect(html).toContain("<dl");
    expect(html).toContain("(07) 5555 0199");
    expect(html).toContain("Send message");
  });
});

describe("ImageContentSplit", () => {
  const base: ImageContentSplitConfig = {
    type: "imageContentSplit",
    heading: "Built for tradespeople, not agencies",
    body: "Every site ships with real content, reviewed before it goes live.",
    media: { src: "/split.jpg", alt: "A completed kitchen renovation" },
  };

  it("visually reorders content to appear after the image via CSS order, keeping reading order stable", () => {
    // Reading/DOM order stays heading-then-image regardless of visual
    // position — screen readers follow DOM order, not CSS `order`.
    const html = renderToStaticMarkup(<ImageContentSplit {...base} imagePosition="left" />);
    const imgIndex = html.indexOf("<img");
    const headingIndex = html.indexOf("Built for tradespeople");
    expect(imgIndex).toBeGreaterThanOrEqual(0);
    expect(headingIndex).toBeLessThan(imgIndex);
    expect(html).toContain("lg:order-2");
  });

  it("applies no CSS reordering by default (imagePosition right)", () => {
    const html = renderToStaticMarkup(<ImageContentSplit {...base} />);
    expect(html).not.toContain("lg:order-2");
  });
});

describe("Logos", () => {
  it("requires real alt text per logo, same as any other image", () => {
    const config: LogosConfig = {
      type: "logos",
      logos: [{ src: "/partner-a.svg", alt: "Partner A logo" }],
    };
    const html = renderToStaticMarkup(<Logos {...config} />);
    expect(html).toContain('alt="Partner A logo"');
  });
});

describe("Team", () => {
  it("renders a real name and role per member, no placeholder headshot required", () => {
    const config: TeamConfig = {
      type: "team",
      members: [{ name: "Priya Shah", role: "Founder & Lead Designer" }],
    };
    const html = renderToStaticMarkup(<Team {...config} />);
    expect(html).toContain("Priya Shah");
    expect(html).toContain("Founder &amp; Lead Designer");
  });
});

describe("Portfolio", () => {
  it("wraps a project in a link only when an href is provided", () => {
    const config: PortfolioConfig = {
      type: "portfolio",
      projects: [
        { title: "Riverside Cafe rebrand", media: { src: "/p1.jpg", alt: "Riverside Cafe storefront" }, href: "/work/riverside-cafe" },
        { title: "Internal ops dashboard", media: { src: "/p2.jpg", alt: "Dashboard screenshot" } },
      ],
    };
    const html = renderToStaticMarkup(<Portfolio {...config} />);
    expect(html).toContain('href="/work/riverside-cafe"');
    expect(html).toContain("Internal ops dashboard");
  });
});
