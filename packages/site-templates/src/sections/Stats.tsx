import type { StatsConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { toneClasses } from "@/primitives/tone";

/** Every value must be a real, sourced figure passed in via config —
 * this component never computes or guesses a number. */
export function Stats({ heading, stats, tone = "dark" }: StatsConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading ?? "Key figures"}>
      {heading && <Heading title={heading} align="center" muted={muted} />}
      <dl className={`grid grid-cols-2 gap-8 text-center sm:grid-cols-4 ${heading ? "mt-12" : ""}`}>
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd className="text-4xl font-semibold tracking-tight">{stat.value}</dd>
            <p className={`mt-2 text-sm ${muted}`}>{stat.label}</p>
          </div>
        ))}
      </dl>
    </Section>
  );
}
