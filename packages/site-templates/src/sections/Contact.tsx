import type { ContactConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { Media } from "@/primitives/Media";
import { Form } from "@/primitives/Form";
import { toneClasses } from "@/primitives/tone";

export function Contact({ heading, subheading, details, form, media, tone = "light" }: ContactConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} ariaLabel={heading ?? "Contact"}>
      {heading && <Heading title={heading} subtitle={subheading} muted={muted} />}
      <div className={`grid gap-12 lg:grid-cols-2 ${heading ? "mt-12" : ""}`}>
        <div>
          {details.length > 0 && (
            <dl className="space-y-4">
              {details.map((detail) => (
                <div key={detail.label}>
                  <dt className="text-sm font-medium text-neutral-500">{detail.label}</dt>
                  <dd className="mt-1 text-neutral-900">
                    {detail.href ? (
                      <a href={detail.href} className="hover:underline">
                        {detail.value}
                      </a>
                    ) : (
                      detail.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {media && <Media media={media} aspect="aspect-[4/3]" className="mt-6 rounded-lg" />}
        </div>
        {form && <Form form={form} />}
      </div>
    </Section>
  );
}
