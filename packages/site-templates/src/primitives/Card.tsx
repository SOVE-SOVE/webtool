import type { CtaLink, Media as MediaConfig } from "@/types";
import { Media } from "@/primitives/Media";

export function Card({
  media,
  icon,
  eyebrow,
  title,
  description,
  cta,
}: {
  media?: MediaConfig;
  /** Short text/emoji marker rendered when there's no photo (services,
   * features) — never a fabricated icon font dependency. */
  icon?: string;
  /** Secondary line above the title — a role, category, or tag. */
  eyebrow?: string;
  title: string;
  description?: string;
  cta?: CtaLink;
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-neutral-200 bg-white p-6">
      {media && <Media media={media} aspect="aspect-square" className="mb-4 rounded-md" />}
      {!media && icon && (
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-neutral-100 text-lg" aria-hidden="true">
          {icon}
        </span>
      )}
      {eyebrow && <p className="text-sm font-medium text-neutral-500">{eyebrow}</p>}
      <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
      {description && <p className="mt-2 flex-1 text-sm text-neutral-600">{description}</p>}
      {cta && (
        <a href={cta.href} className="mt-4 text-sm font-medium text-neutral-900 hover:underline">
          {cta.label} →
        </a>
      )}
    </div>
  );
}
