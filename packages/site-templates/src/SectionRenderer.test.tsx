import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SectionList, SectionRenderer } from "@/SectionRenderer";
import type { SiteSection } from "@/types";

describe("SectionRenderer", () => {
  it("dispatches a config to its registered component by type", () => {
    const section: SiteSection = { type: "hero", heading: "Built for real trades businesses" };
    const html = renderToStaticMarkup(<SectionRenderer section={section} />);
    expect(html).toContain("Built for real trades businesses");
  });
});

describe("SectionList", () => {
  it("renders every section in order, from a page's full config", () => {
    const sections: SiteSection[] = [
      { type: "hero", heading: "Coastal Cafe" },
      { type: "serviceCards", services: [{ title: "Breakfast", description: "Served all day." }] },
      { type: "footer", copyrightHolder: "Coastal Cafe Pty Ltd" },
    ];
    const html = renderToStaticMarkup(<SectionList sections={sections} />);
    const heroIndex = html.indexOf("Coastal Cafe");
    const servicesIndex = html.indexOf("Breakfast");
    const footerIndex = html.indexOf("Coastal Cafe Pty Ltd");
    expect(heroIndex).toBeGreaterThanOrEqual(0);
    expect(heroIndex).toBeLessThan(servicesIndex);
    expect(servicesIndex).toBeLessThan(footerIndex);
  });
});
