import type { FormSectionConfig } from "@/types";
import { Section } from "@/primitives/Section";
import { Heading } from "@/primitives/Heading";
import { Form } from "@/primitives/Form";
import { toneClasses } from "@/primitives/tone";

/** A standalone form section (newsletter signup, quote request, ...)
 * distinct from Contact, which pairs a form with contact details. */
export function FormSection({ heading, subheading, form, tone = "light" }: FormSectionConfig) {
  const { muted } = toneClasses(tone);
  return (
    <Section tone={tone} narrow ariaLabel={heading ?? "Form"}>
      {heading && <Heading title={heading} subtitle={subheading} align="center" muted={muted} />}
      <div className={heading ? "mt-8" : ""}>
        <Form form={form} />
      </div>
    </Section>
  );
}
