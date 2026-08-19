import type { LogosConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { toneClasses } from "@/primitives/tone";

/** A quiet trust strip — deliberately small/grayscale-friendly logos,
 * not a decorative carousel. */
export function Logos({ heading, logos, tone = "muted" }: LogosConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading ?? "Featured in / worked with"}>
      {heading && <Heading title={heading} align="center" muted={muted} level="h3" />}
      <ul className={`flex flex-wrap items-center justify-center gap-x-10 gap-y-6 ${heading ? "mt-10" : ""}`}>
        {logos.map((logo, index) => (
          <li key={index}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo.src} alt={logo.alt} className="h-8 w-auto opacity-70 grayscale" />
          </li>
        ))}
      </ul>
    </Section>
  );
}
