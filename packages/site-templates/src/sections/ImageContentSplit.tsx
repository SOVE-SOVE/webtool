import type { ImageContentSplitConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Media } from "@/primitives/Media";
import { Button } from "@/primitives/Button";
import { toneClasses } from "@/primitives/tone";

export function ImageContentSplit({ heading, body, media, imagePosition = "right", cta, tone = "light" }: ImageContentSplitConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading}>
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className={imagePosition === "left" ? "lg:order-2" : ""}>
          <h2 className="text-3xl font-semibold tracking-tight">{heading}</h2>
          <p className={`mt-4 ${muted}`}>{body}</p>
          {cta && <Button {...cta} variant={cta.variant ?? "primary"} className="mt-6" />}
        </div>
        <Media media={media} aspect="aspect-[4/3]" className="rounded-lg" />
      </div>
    </Section>
  );
}
