import type { CtaSectionConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { Button } from "@/primitives/Button";
import { toneClasses } from "@/primitives/tone";

/** A single, focused call to action — the section exists to drive one
 * decision, so it takes exactly one primary + optional secondary CTA. */
export function Cta({ heading, body, primaryCta, secondaryCta, tone = "dark" }: CtaSectionConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel="Call to action">
      <div className="text-center">
        <Heading title={heading} subtitle={body} align="center" muted={muted} />
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Button {...primaryCta} variant={primaryCta.variant ?? "primary"} />
          {secondaryCta && <Button {...secondaryCta} variant={secondaryCta.variant ?? "outline"} />}
        </div>
      </div>
    </Section>
  );
}
