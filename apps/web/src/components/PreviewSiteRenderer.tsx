// Renders a website's stored section config (the same shape
// packages/site-templates renders, see apps/api's
// modules/websites/models.py) as real, readable markup for the public
// preview surface. Deliberately a self-contained reimplementation, not
// a reuse of packages/site-templates — that package has no build step
// and resolves its own internal "@/..." imports via its own tsconfig,
// which apps/web has no workspace tooling to share; duplicating the
// handful of layout patterns here is far less machinery than adding a
// cross-package build pipeline for one consumer. Every section degrades
// gracefully: an unknown/missing field is simply not rendered, never
// invented.

import type { ReactNode } from "react";
import type { PreviewSection } from "@/lib/previewApi";

type CtaLink = { label: string; href: string; variant?: string };
type Media = { src: string; alt: string };

function cfg(section: PreviewSection): Record<string, unknown> {
  return section.config ?? {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function CtaButton({ cta, primary }: { cta: CtaLink; primary?: boolean }) {
  return (
    <a
      href={cta.href || "#"}
      className={
        primary
          ? "inline-block rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
          : "inline-block rounded-md border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
      }
    >
      {cta.label}
    </a>
  );
}

function Heading({ eyebrow, heading, subheading, center }: { eyebrow?: string; heading?: string; subheading?: string; center?: boolean }) {
  return (
    <div className={center ? "text-center" : ""}>
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{eyebrow}</p>}
      {heading && <h2 className="mt-1 text-2xl font-semibold text-neutral-900 sm:text-3xl">{heading}</h2>}
      {subheading && <p className="mt-3 text-base text-neutral-600">{subheading}</p>}
    </div>
  );
}

function SectionShell({ children, tone }: { children: ReactNode; tone?: string }) {
  const bg = tone === "dark" ? "bg-neutral-900 text-white" : tone === "brand" ? "bg-neutral-100" : tone === "muted" ? "bg-neutral-50" : "bg-white";
  return (
    <section className={`${bg} px-4 py-14 sm:px-8`}>
      <div className="mx-auto max-w-4xl">{children}</div>
    </section>
  );
}

function renderSection(section: PreviewSection): ReactNode {
  const c = cfg(section);
  const tone = str(c.tone);

  switch (section.type) {
    case "navigation": {
      const logo = c.logo as { label?: string } | undefined;
      const links = arr<CtaLink>(c.links);
      const cta = c.cta as CtaLink | undefined;
      return (
        <nav className="flex items-center justify-between border-b border-neutral-200 px-4 py-4 sm:px-8">
          <span className="font-semibold text-neutral-900">{logo?.label ?? ""}</span>
          <div className="hidden items-center gap-6 text-sm text-neutral-600 sm:flex">
            {links.map((l, i) => (
              <a key={i} href={l.href}>
                {l.label}
              </a>
            ))}
          </div>
          {cta && <CtaButton cta={cta} primary />}
        </nav>
      );
    }

    case "hero": {
      const primaryCta = c.primaryCta as CtaLink | undefined;
      const secondaryCta = c.secondaryCta as CtaLink | undefined;
      const center = c.align === "center";
      return (
        <SectionShell tone={tone}>
          <Heading eyebrow={str(c.eyebrow)} heading={str(c.heading)} subheading={str(c.subheading)} center={center} />
          {(primaryCta || secondaryCta) && (
            <div className={`mt-6 flex flex-wrap gap-3 ${center ? "justify-center" : ""}`}>
              {primaryCta && <CtaButton cta={primaryCta} primary />}
              {secondaryCta && <CtaButton cta={secondaryCta} />}
            </div>
          )}
        </SectionShell>
      );
    }

    case "cta": {
      const primaryCta = c.primaryCta as CtaLink | undefined;
      const secondaryCta = c.secondaryCta as CtaLink | undefined;
      return (
        <SectionShell tone={tone ?? "muted"}>
          <div className="text-center">
            <Heading heading={str(c.heading)} />
            {str(c.body) && <p className="mt-3 text-neutral-600">{str(c.body)}</p>}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {primaryCta && <CtaButton cta={primaryCta} primary />}
              {secondaryCta && <CtaButton cta={secondaryCta} />}
            </div>
          </div>
        </SectionShell>
      );
    }

    case "serviceCards": {
      const services = arr<{ title: string; description: string }>(c.services);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s, i) => (
              <div key={i} className="rounded-lg border border-neutral-200 p-5">
                <h3 className="font-semibold text-neutral-900">{s.title}</h3>
                <p className="mt-2 text-sm text-neutral-600">{s.description}</p>
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "features": {
      const features = arr<{ title: string; description: string }>(c.features);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {features.map((f, i) => (
              <div key={i}>
                <h3 className="font-semibold text-neutral-900">{f.title}</h3>
                <p className="mt-2 text-sm text-neutral-600">{f.description}</p>
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "testimonials": {
      const testimonials = arr<{ quote: string; authorName: string; authorRole?: string }>(c.testimonials);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} center />
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {testimonials.map((t, i) => (
              <blockquote key={i} className="rounded-lg bg-neutral-50 p-5">
                <p className="text-neutral-700">&ldquo;{t.quote}&rdquo;</p>
                <footer className="mt-3 text-sm font-medium text-neutral-900">
                  {t.authorName}
                  {t.authorRole && <span className="font-normal text-neutral-500"> — {t.authorRole}</span>}
                </footer>
              </blockquote>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "pricing": {
      const tiers = arr<{ name: string; price: string; period?: string; description?: string; features: string[]; cta: CtaLink; highlighted?: boolean }>(
        c.tiers,
      );
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {tiers.map((t, i) => (
              <div key={i} className={`rounded-lg border p-6 ${t.highlighted ? "border-neutral-900" : "border-neutral-200"}`}>
                <h3 className="font-semibold text-neutral-900">{t.name}</h3>
                <p className="mt-2 text-2xl font-semibold text-neutral-900">
                  {t.price}
                  {t.period && <span className="text-sm font-normal text-neutral-500">/{t.period}</span>}
                </p>
                {t.description && <p className="mt-2 text-sm text-neutral-600">{t.description}</p>}
                <ul className="mt-4 space-y-1 text-sm text-neutral-600">
                  {(t.features ?? []).map((f, fi) => (
                    <li key={fi}>✓ {f}</li>
                  ))}
                </ul>
                <div className="mt-5">
                  <CtaButton cta={t.cta} primary />
                </div>
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "faq": {
      const items = arr<{ question: string; answer: string }>(c.items);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className="mt-8 space-y-4">
            {items.map((f, i) => (
              <div key={i} className="border-b border-neutral-200 pb-4">
                <p className="font-medium text-neutral-900">{f.question}</p>
                <p className="mt-1 text-sm text-neutral-600">{f.answer}</p>
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "contact": {
      const details = arr<{ label: string; value: string; href?: string }>(c.details);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className="mt-8 flex flex-wrap justify-center gap-8 text-sm">
            {details.map((d, i) => (
              <div key={i}>
                <p className="text-neutral-500">{d.label}</p>
                {d.href ? (
                  <a href={d.href} className="font-medium text-neutral-900">
                    {d.value}
                  </a>
                ) : (
                  <p className="font-medium text-neutral-900">{d.value}</p>
                )}
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "imageContentSplit": {
      const media = c.media as Media | undefined;
      const cta = c.cta as CtaLink | undefined;
      const imageLeft = c.imagePosition !== "right";
      return (
        <SectionShell tone={tone}>
          <div className={`grid items-center gap-8 sm:grid-cols-2 ${imageLeft ? "" : "sm:[direction:rtl]"}`}>
            <div className="[direction:ltr]">
              <h2 className="text-2xl font-semibold text-neutral-900">{str(c.heading)}</h2>
              <p className="mt-3 text-neutral-600">{str(c.body)}</p>
              {cta && (
                <div className="mt-5">
                  <CtaButton cta={cta} primary />
                </div>
              )}
            </div>
            <div className="[direction:ltr]">{media && <ImagePlaceholder alt={media.alt} />}</div>
          </div>
        </SectionShell>
      );
    }

    case "gallery": {
      const images = arr<Media>(c.images);
      // Tailwind scans source for literal class names — a template-
      // interpolated `sm:grid-cols-${n}` would never be generated, so
      // the column count is mapped to a fixed set of literal classes.
      const columnClass = c.columns === 2 ? "sm:grid-cols-2" : c.columns === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className={`mt-8 grid grid-cols-2 gap-4 ${columnClass}`}>
            {images.map((img, i) => (
              <ImagePlaceholder key={i} alt={img.alt} />
            ))}
          </div>
        </SectionShell>
      );
    }

    case "stats": {
      const stats = arr<{ value: string; label: string }>(c.stats);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} center />
          <div className="mt-8 grid grid-cols-2 gap-6 text-center sm:grid-cols-4">
            {stats.map((s, i) => (
              <div key={i}>
                <p className="text-2xl font-semibold text-neutral-900">{s.value}</p>
                <p className="text-sm text-neutral-500">{s.label}</p>
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "logos": {
      const logos = arr<{ label: string }>(c.logos);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} center />
          <div className="mt-6 flex flex-wrap justify-center gap-8 text-sm font-medium text-neutral-500">
            {logos.map((l, i) => (
              <span key={i}>{l.label}</span>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "team": {
      const members = arr<{ name: string; role: string; bio?: string }>(c.members);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m, i) => (
              <div key={i} className="text-center">
                <p className="font-semibold text-neutral-900">{m.name}</p>
                <p className="text-sm text-neutral-500">{m.role}</p>
                {m.bio && <p className="mt-2 text-sm text-neutral-600">{m.bio}</p>}
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "portfolio": {
      const projects = arr<{ title: string; category?: string; description?: string; media: Media }>(c.projects);
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p, i) => (
              <div key={i}>
                <ImagePlaceholder alt={p.media?.alt ?? p.title} />
                <p className="mt-2 font-medium text-neutral-900">{p.title}</p>
                {p.category && <p className="text-xs text-neutral-500">{p.category}</p>}
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "form": {
      const form = c.form as { fields: { name: string; label: string; type: string }[]; submitLabel: string } | undefined;
      return (
        <SectionShell tone={tone}>
          <Heading heading={str(c.heading)} subheading={str(c.subheading)} center />
          <div className="mx-auto mt-8 max-w-md space-y-3">
            {(form?.fields ?? []).map((f, i) => (
              <div key={i}>
                <label className="text-sm text-neutral-600">{f.label}</label>
                {f.type === "textarea" ? (
                  <textarea disabled className="mt-1 w-full rounded-md border border-neutral-300 p-2 text-sm" />
                ) : (
                  <input disabled className="mt-1 w-full rounded-md border border-neutral-300 p-2 text-sm" />
                )}
              </div>
            ))}
            <button disabled className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white opacity-70">
              {form?.submitLabel ?? "Submit"}
            </button>
          </div>
        </SectionShell>
      );
    }

    case "footer": {
      const columns = arr<{ heading: string; links: CtaLink[] }>(c.columns);
      return (
        <footer className="border-t border-neutral-200 bg-neutral-50 px-4 py-10 text-sm sm:px-8">
          <div className="mx-auto max-w-4xl">
            {str(c.tagline) && <p className="text-neutral-600">{str(c.tagline)}</p>}
            <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4">
              {columns.map((col, i) => (
                <div key={i}>
                  <p className="font-medium text-neutral-900">{col.heading}</p>
                  <ul className="mt-2 space-y-1 text-neutral-600">
                    {(col.links ?? []).map((l, li) => (
                      <li key={li}>
                        <a href={l.href}>{l.label}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-neutral-400">© {str(c.copyrightHolder) ?? ""}</p>
          </div>
        </footer>
      );
    }

    default:
      return null;
  }
}

function ImagePlaceholder({ alt }: { alt: string }) {
  return (
    <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-neutral-100 text-center text-xs text-neutral-400">
      {alt}
    </div>
  );
}

export function PreviewSiteRenderer({ navigation, sections, footer }: { navigation: PreviewSection; sections: PreviewSection[]; footer: PreviewSection }) {
  return (
    <div className="bg-white">
      {renderSection(navigation)}
      <main>{sections.map((s) => <div key={s.id}>{renderSection(s)}</div>)}</main>
      {renderSection(footer)}
    </div>
  );
}
