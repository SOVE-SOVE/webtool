import type { TeamConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { CardGrid } from "@/primitives/CardGrid";
import { Media } from "@/primitives/Media";
import { toneClasses } from "@/primitives/tone";

export function Team({ heading, subheading, members, tone = "light" }: TeamConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading ?? "Team"}>
      {heading && <Heading title={heading} subtitle={subheading} align="center" muted={muted} />}
      <div className={heading ? "mt-12" : ""}>
        <CardGrid
          items={members}
          columns={members.length === 2 ? 2 : members.length >= 4 ? 4 : 3}
          renderItem={(member) => (
            <div className="text-center">
              {member.photo && <Media media={member.photo} aspect="aspect-square" className="rounded-full" />}
              <h3 className="mt-4 text-lg font-semibold text-neutral-900">{member.name}</h3>
              <p className="text-sm text-neutral-500">{member.role}</p>
              {member.bio && <p className="mt-2 text-sm text-neutral-600">{member.bio}</p>}
            </div>
          )}
        />
      </div>
    </Section>
  );
}
