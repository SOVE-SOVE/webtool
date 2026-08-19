import type { ReactNode } from "react";
import type { Tone } from "@/types";
import { toneClasses } from "@/primitives/tone";
import { Container } from "@/primitives/Container";

export function Section({
  id,
  tone = "light",
  children,
  ariaLabel,
  className = "",
  narrow = false,
}: {
  id?: string;
  tone?: Tone;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  /** Narrower container for text-heavy sections (FAQ, split content). */
  narrow?: boolean;
}) {
  const { bg, text } = toneClasses(tone);
  return (
    <section id={id} aria-label={ariaLabel} className={`${bg} ${text} py-16 sm:py-20 lg:py-24 ${className}`}>
      <Container width={narrow ? "narrow" : "default"}>{children}</Container>
    </section>
  );
}
