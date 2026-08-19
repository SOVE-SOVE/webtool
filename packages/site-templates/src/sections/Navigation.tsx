import type { NavigationConfig } from "@/types";
import { Container } from "@/primitives/Container";
import { Button } from "@/primitives/Button";

export function Navigation({ logo, links, cta }: NavigationConfig) {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <Container className="flex h-16 items-center justify-between">
        <a href={logo.href ?? "/"} className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
          {logo.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.image.src} alt={logo.image.alt} className="h-8 w-auto" />
          )}
          {logo.label}
        </a>
        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-medium text-neutral-700 hover:text-neutral-900">
              {link.label}
            </a>
          ))}
        </nav>
        {cta && <Button {...cta} variant={cta.variant ?? "primary"} />}
      </Container>
    </header>
  );
}
