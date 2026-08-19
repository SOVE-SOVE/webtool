import type { PortfolioConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { CardGrid } from "@/primitives/CardGrid";
import { Media } from "@/primitives/Media";
import { toneClasses } from "@/primitives/tone";

export function Portfolio({ heading, subheading, projects, tone = "light" }: PortfolioConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading ?? "Our work"}>
      {heading && <Heading title={heading} subtitle={subheading} align="center" muted={muted} />}
      <div className={heading ? "mt-12" : ""}>
        <CardGrid
          items={projects}
          columns={projects.length === 2 ? 2 : 3}
          renderItem={(project) => {
            const content = (
              <>
                <Media media={project.media} aspect="aspect-[4/3]" className="rounded-md" />
                {project.category && <p className="mt-3 text-sm font-medium text-neutral-500">{project.category}</p>}
                <h3 className="text-lg font-semibold text-neutral-900">{project.title}</h3>
                {project.description && <p className="mt-1 text-sm text-neutral-600">{project.description}</p>}
              </>
            );
            return project.href ? (
              <a href={project.href} className="block">
                {content}
              </a>
            ) : (
              <div>{content}</div>
            );
          }}
        />
      </div>
    </Section>
  );
}
