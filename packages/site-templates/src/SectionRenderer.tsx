import type { ComponentType } from "react";
import type { SiteSection } from "@/types";
import { getSectionEntry } from "@/registry";

/**
 * Renders any SiteSection config via its registered component. This is
 * the one place a page-assembly step (the future website generator)
 * needs to touch to go from a list of section configs to real markup —
 * it never needs to know which component maps to which `type` itself.
 */
export function SectionRenderer({ section }: { section: SiteSection }) {
  const entry = getSectionEntry(section.type);
  const Component = entry.component as ComponentType<SiteSection>;
  return <Component {...section} />;
}

export function SectionList({ sections }: { sections: SiteSection[] }) {
  return (
    <>
      {sections.map((section, index) => (
        <SectionRenderer key={index} section={section} />
      ))}
    </>
  );
}
