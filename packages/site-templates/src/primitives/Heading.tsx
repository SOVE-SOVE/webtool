type HeadingLevel = "h1" | "h2" | "h3";

export function Heading({
  eyebrow,
  title,
  subtitle,
  level = "h2",
  align = "left",
  muted,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  level?: HeadingLevel;
  align?: "left" | "center";
  /** Subtitle text color class — sections pass their tone's muted color
   * so this stays legible on dark backgrounds too. */
  muted?: string;
}) {
  const Tag = level;
  const titleSize =
    level === "h1"
      ? "text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight"
      : level === "h2"
        ? "text-3xl sm:text-4xl font-semibold tracking-tight"
        : "text-2xl font-semibold tracking-tight";
  const wrapperAlign = align === "center" ? "mx-auto text-center" : "text-left";

  return (
    <div className={`max-w-2xl ${wrapperAlign}`}>
      {eyebrow && <p className="text-sm font-semibold uppercase tracking-wide text-current opacity-70">{eyebrow}</p>}
      <Tag className={`${titleSize} ${eyebrow ? "mt-2" : ""}`}>{title}</Tag>
      {subtitle && <p className={`mt-4 text-lg ${muted ?? "text-neutral-600"}`}>{subtitle}</p>}
    </div>
  );
}
