import { describe, expect, it } from "vitest";
import { isSectionValid, validateSection } from "@/validate";
import type { HeroConfig, ServiceCardsConfig, TestimonialsConfig } from "@/types";

describe("validateSection", () => {
  it("passes when every required field is present", () => {
    const hero: HeroConfig = { type: "hero", heading: "Real, honest hot water repairs" };
    expect(validateSection(hero)).toEqual([]);
    expect(isSectionValid(hero)).toBe(true);
  });

  it("flags a missing required string field", () => {
    const hero = { type: "hero", heading: "" } as HeroConfig;
    const issues = validateSection(hero);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("heading");
  });

  it("flags a missing required array field, including an explicitly empty one", () => {
    const services: ServiceCardsConfig = { type: "serviceCards", services: [] };
    const issues = validateSection(services);
    expect(issues.map((i) => i.field)).toContain("services");
  });

  it("never treats a populated array as missing", () => {
    const testimonials: TestimonialsConfig = {
      type: "testimonials",
      testimonials: [{ quote: "They fixed it same day.", authorName: "R. Nguyen" }],
    };
    expect(isSectionValid(testimonials)).toBe(true);
  });

  it("reports every missing field, not just the first", () => {
    const contact = { type: "contact", details: [] } as import("@/types").ContactConfig;
    const issues = validateSection(contact);
    expect(issues.map((i) => i.field)).toEqual(["details"]);
  });
});
