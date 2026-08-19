import type { TestimonialsConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { Media } from "@/primitives/Media";
import { toneClasses } from "@/primitives/tone";

/** Every testimonial is real, sourced content passed in via config —
 * this component has no fallback/placeholder quote, so an empty list
 * renders nothing rather than inventing one. */
export function Testimonials({ heading, testimonials, tone = "muted" }: TestimonialsConfig) {
  const { muted, border } = toneClasses(tone);
  if (testimonials.length === 0) return null;

  return (
    <Section tone={tone} ariaLabel={heading ?? "Testimonials"}>
      {heading && <Heading title={heading} align="center" muted={muted} />}
      <div className={`grid gap-6 md:grid-cols-2 lg:grid-cols-3 ${heading ? "mt-12" : ""}`}>
        {testimonials.map((testimonial, index) => (
          <figure key={index} className={`rounded-lg border ${border} bg-white p-6`}>
            <blockquote className="text-neutral-900">
              <p>&ldquo;{testimonial.quote}&rdquo;</p>
            </blockquote>
            <figcaption className="mt-4 flex items-center gap-3">
              {testimonial.authorPhoto && <Media media={testimonial.authorPhoto} aspect="aspect-square" className="h-10 w-10 rounded-full" />}
              <div>
                <p className="text-sm font-semibold text-neutral-900">{testimonial.authorName}</p>
                {testimonial.authorRole && <p className="text-sm text-neutral-500">{testimonial.authorRole}</p>}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}
