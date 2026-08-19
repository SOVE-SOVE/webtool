import type { PricingConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { Button } from "@/primitives/Button";
import { toneClasses } from "@/primitives/tone";

// Tailwind needs literal class names in source to generate them —
// no template-literal column counts.
const GRID_COLS: Record<1 | 2 | 3, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
};

export function Pricing({ heading, subheading, tiers, tone = "light" }: PricingConfig) {
  const { muted } = toneClasses(tone);
  const columns = Math.min(tiers.length, 3) as 1 | 2 | 3;
  return (
    <Section tone={tone} ariaLabel={heading ?? "Pricing"}>
      {heading && <Heading title={heading} subtitle={subheading} align="center" muted={muted} />}
      <div className={`grid gap-6 ${GRID_COLS[columns] ?? GRID_COLS[3]} ${heading ? "mt-12" : ""}`}>
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`flex flex-col rounded-lg border p-8 ${tier.highlighted ? "border-neutral-900 shadow-sm" : "border-neutral-200"}`}
          >
            {tier.highlighted && <p className="text-sm font-semibold text-neutral-900">Most popular</p>}
            <h3 className="mt-1 text-xl font-semibold text-neutral-900">{tier.name}</h3>
            <p className="mt-4 text-3xl font-semibold text-neutral-900">
              {tier.price}
              {tier.period && <span className="text-base font-normal text-neutral-500"> / {tier.period}</span>}
            </p>
            {tier.description && <p className="mt-2 text-sm text-neutral-600">{tier.description}</p>}
            {tier.features.length > 0 && (
              <ul className="mt-6 flex-1 space-y-3 text-sm text-neutral-700">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            )}
            <Button {...tier.cta} variant={tier.highlighted ? "primary" : "secondary"} className="mt-8 w-full" />
          </div>
        ))}
      </div>
    </Section>
  );
}
