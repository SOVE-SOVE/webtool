import type { ServiceCardsConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { CardGrid } from "@/primitives/CardGrid";
import { Card } from "@/primitives/Card";
import { toneClasses } from "@/primitives/tone";

export function ServiceCards({ heading, subheading, services, tone = "light" }: ServiceCardsConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading ?? "Services"}>
      {heading && <Heading title={heading} subtitle={subheading} align="center" muted={muted} />}
      <div className={heading ? "mt-12" : ""}>
        <CardGrid
          items={services}
          columns={services.length === 2 ? 2 : 3}
          renderItem={(service) => (
            <Card icon={service.icon} title={service.title} description={service.description} cta={service.cta} />
          )}
        />
      </div>
    </Section>
  );
}
