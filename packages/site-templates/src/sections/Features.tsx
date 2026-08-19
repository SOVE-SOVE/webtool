import type { FeaturesConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { CardGrid } from "@/primitives/CardGrid";
import { Card } from "@/primitives/Card";
import { Media } from "@/primitives/Media";
import { toneClasses } from "@/primitives/tone";

/** "grid" layout is a CardGrid of icon/media cards; "alternating" is a
 * stacked series of image-left/image-right rows — better for a small
 * number of features that each need more room to explain. */
export function Features({ heading, subheading, features, layout = "grid", tone = "light" }: FeaturesConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading ?? "Features"}>
      {heading && <Heading title={heading} subtitle={subheading} align="center" muted={muted} />}
      <div className={heading ? "mt-12" : ""}>
        {layout === "grid" ? (
          <CardGrid
            items={features}
            columns={features.length === 2 ? 2 : 3}
            renderItem={(feature) => (
              <Card icon={feature.icon} media={feature.media} title={feature.title} description={feature.description} />
            )}
          />
        ) : (
          <div className="space-y-16">
            {features.map((feature, index) => (
              <div key={feature.title} className={`grid items-center gap-10 lg:grid-cols-2 ${index % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""}`}>
                {feature.media ? (
                  <Media media={feature.media} aspect="aspect-[4/3]" className="rounded-lg" />
                ) : (
                  <div aria-hidden="true" />
                )}
                <div>
                  <h3 className="text-2xl font-semibold">{feature.title}</h3>
                  <p className={`mt-3 ${muted}`}>{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
