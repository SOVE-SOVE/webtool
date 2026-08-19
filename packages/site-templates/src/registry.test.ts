import { describe, expect, it } from "vitest";
import { SECTION_REGISTRY, SECTION_TYPES, getSectionEntry, getSectionsForPageType } from "@/registry";

describe("registry", () => {
  it("has an entry for every section type with required metadata", () => {
    for (const type of SECTION_TYPES) {
      const entry = SECTION_REGISTRY[type];
      expect(entry.type).toBe(type);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.component).toBeDefined();
      expect(entry.pageTypes.length).toBeGreaterThan(0);
    }
  });

  it("getSectionEntry returns the matching entry", () => {
    expect(getSectionEntry("hero").type).toBe("hero");
    expect(getSectionEntry("pricing").label).toBe("Pricing");
  });

  it("getSectionsForPageType only returns non-structural sections valid for that page", () => {
    const homeSections = getSectionsForPageType("home");
    expect(homeSections.some((s) => s.type === "hero")).toBe(true);
    expect(homeSections.every((s) => !s.structural)).toBe(true);
    // Navigation/Footer are page-agnostic structural elements, not
    // per-page content choices.
    expect(homeSections.some((s) => s.type === "navigation")).toBe(false);
    expect(homeSections.some((s) => s.type === "footer")).toBe(false);
  });

  it("getSectionsForPageType returns nothing irrelevant for a narrow page type", () => {
    const faqSections = getSectionsForPageType("faq");
    expect(faqSections.every((s) => s.pageTypes.includes("faq"))).toBe(true);
  });
});
