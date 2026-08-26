import type { ReactNode } from "react";
import type { SectionSpacing, Tone } from "@/types";
import { toneClasses } from "@/primitives/tone";
import { Container } from "@/primitives/Container";

const SPACING_CLASSES: Record<SectionSpacing, string> = {
  default: "py-16 sm:py-20 lg:py-24",
  compact: "py-8 sm:py-12 lg:py-16",
};

export function Section({
  id,
  tone = "light",
  children,
  ariaLabel,
  className = "",
  narrow = false,
  spacing = "default",
}: {
  id?: string;
  tone?: Tone;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  /** Narrower container for text-heavy sections (FAQ, split content). */
  narrow?: boolean;
  /** "compact" tightens vertical padding, most noticeably on mobile. */
  spacing?: SectionSpacing;
}) {
  const { bg, text } = toneClasses(tone);
  return (
    <section id={id} aria-label={ariaLabel} className={`${bg} ${text} ${SPACING_CLASSES[spacing]} ${className}`}>
      <Container width={narrow ? "narrow" : "default"}>{children}</Container>
    </section>
  );
}
