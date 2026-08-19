import type { FooterConfig } from "@/types";
import { Container } from "@/primitives/Container";

export function Footer({ logo, tagline, columns = [], socialLinks = [], contact, legalLinks = [], copyrightHolder }: FooterConfig) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-neutral-200 bg-white">
      <Container className="py-12">
        <div className="grid gap-10 md:grid-cols-[2fr_repeat(auto-fit,minmax(120px,1fr))]">
          <div>
            {logo && (
              <a href={logo.href ?? "/"} className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
                {logo.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo.image.src} alt={logo.image.alt} className="h-7 w-auto" />
                )}
                {logo.label}
              </a>
            )}
            {tagline && <p className="mt-3 max-w-xs text-sm text-neutral-600">{tagline}</p>}
            {contact && (
              <ul className="mt-4 space-y-1 text-sm text-neutral-600">
                {contact.email && (
                  <li>
                    <a href={`mailto:${contact.email}`} className="hover:underline">
                      {contact.email}
                    </a>
                  </li>
                )}
                {contact.phone && (
                  <li>
                    <a href={`tel:${contact.phone}`} className="hover:underline">
                      {contact.phone}
                    </a>
                  </li>
                )}
                {contact.address && <li>{contact.address}</li>}
              </ul>
            )}
            {socialLinks.length > 0 && (
              <ul className="mt-4 flex gap-4">
                {socialLinks.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="text-sm text-neutral-600 hover:text-neutral-900">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {columns.map((column) => (
            <div key={column.heading}>
              <h3 className="text-sm font-semibold text-neutral-900">{column.heading}</h3>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="text-sm text-neutral-600 hover:text-neutral-900">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-4 border-t border-neutral-200 pt-6 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {copyrightHolder}. All rights reserved.
          </p>
          {legalLinks.length > 0 && (
            <ul className="flex gap-4">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="hover:underline">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Container>
    </footer>
  );
}
