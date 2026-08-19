import type { FaqConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { toneClasses } from "@/primitives/tone";

/** Native <details>/<summary> — an accordion with zero JavaScript,
 * fully keyboard- and screen-reader-accessible by default. */
export function Faq({ heading, subheading, items, tone = "light" }: FaqConfig) {
  const { muted, border } = toneClasses(tone);
  return (
    <Section tone={tone} narrow ariaLabel={heading ?? "Frequently asked questions"}>
      {heading && <Heading title={heading} subtitle={subheading} align="center" muted={muted} />}
      <div className={`divide-y ${border} ${heading ? "mt-12" : ""}`}>
        {items.map((item) => (
          <details key={item.question} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-neutral-900">
              {item.question}
              <span aria-hidden="true" className="ml-4 shrink-0 transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 text-neutral-600">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
