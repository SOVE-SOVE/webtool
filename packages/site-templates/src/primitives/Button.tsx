import type { CtaLink } from "@/types";

const VARIANT_CLASSES: Record<NonNullable<CtaLink["variant"]>, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700 focus-visible:outline-neutral-900",
  secondary: "bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-50 focus-visible:outline-neutral-900",
  outline: "border border-current text-current hover:opacity-80 focus-visible:outline-current",
  ghost: "text-current hover:opacity-70 focus-visible:outline-current",
};

export function Button({ label, href, variant = "primary", external, className = "" }: CtaLink & { className?: string }) {
  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${VARIANT_CLASSES[variant]} ${className}`}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {label}
    </a>
  );
}
