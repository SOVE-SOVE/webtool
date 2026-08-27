import type { HeroConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { Button } from "@/primitives/Button";
import { Media } from "@/primitives/Media";
import { toneClasses } from "@/primitives/tone";

/** The single most important section on a page — strong hierarchy
 * (one heading, one clear primary action), never a wall of competing
 * CTAs or decorative filler. */
export function Hero({ eyebrow, heading, subheading, media, primaryCta, secondaryCta, align = "left", tone = "light", spacing }: HeroConfig) {
  const { muted } = toneClasses(tone);
  const centered = align === "center";

  return (
    <Section tone={tone} spacing={spacing} ariaLabel="Introduction">
      <div className={`grid items-center gap-12 ${media ? "lg:grid-cols-2" : ""}`}>
        <div className={centered && !media ? "mx-auto text-center" : ""}>
          <Heading eyebrow={eyebrow} title={heading} subtitle={subheading} level="h1" align={centered ? "center" : "left"} muted={muted} />
          {(primaryCta || secondaryCta) && (
            <div className={`mt-8 flex flex-wrap gap-4 ${centered && !media ? "justify-center" : ""}`}>
              {primaryCta && <Button {...primaryCta} variant={primaryCta.variant ?? "primary"} />}
              {secondaryCta && <Button {...secondaryCta} variant={secondaryCta.variant ?? "secondary"} />}
            </div>
          )}
        </div>
        {media && <Media media={media} priority aspect="aspect-[4/3]" className="rounded-lg" />}
      </div>
    </Section>
  );
}
