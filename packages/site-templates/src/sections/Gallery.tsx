import type { GalleryConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { Media } from "@/primitives/Media";
import { toneClasses } from "@/primitives/tone";

const COLUMN_CLASSES: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function Gallery({ heading, subheading, images, columns = 3, tone = "light" }: GalleryConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading ?? "Gallery"}>
      {heading && <Heading title={heading} subtitle={subheading} align="center" muted={muted} />}
      <div className={`grid grid-cols-1 gap-4 ${COLUMN_CLASSES[columns]} ${heading ? "mt-12" : ""}`}>
        {images.map((image, index) => (
          <Media key={index} media={image} aspect="aspect-square" className="rounded-md" />
        ))}
      </div>
    </Section>
  );
}
