"""
The provider-agnostic build step: turns a `DeploymentBundle`'s
`config` (the same `{navigation, footer, pages: [...]}` shape
`packages/site-templates` renders — see `agents/website_generator.py`'s
`WebsiteGeneratorOutput`) into a real, deployable set of static HTML
files.

This is deliberately a plain, semantic HTML renderer, not a port of
`packages/site-templates`' React components — those stay the source of
truth for the operator-facing visual preview (roadmap M5). What this
produces is honest and genuinely publishable (valid HTML, real nav/
content, no invented copy) but intentionally minimal: every provider
adapter deploys exactly these files, so building a pixel-accurate
static export is a separate, later piece of work, not a precondition
for the deployment architecture existing. Every value rendered comes
from the bundle's own config — nothing here fabricates content, per
the anti-slop "never invent, report the gap" rule the rest of the
generation pipeline follows.
"""

from __future__ import annotations

import html
import re

from app.integrations.deployment.base import BuildArtifact, DeploymentBundle

_STYLESHEET = """\
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1a1a1a;
  line-height: 1.5;
}
nav { display: flex; gap: 1.5rem; padding: 1rem 1.5rem; border-bottom: 1px solid #eee; }
nav a { color: inherit; text-decoration: none; font-weight: 600; }
main { max-width: 960px; margin: 0 auto; padding: 0 1.5rem; }
section { padding: 3rem 0; border-bottom: 1px solid #f0f0f0; }
section:last-child { border-bottom: none; }
h1 { font-size: 2.25rem; margin: 0 0 0.75rem; }
h2 { font-size: 1.5rem; margin: 0 0 0.75rem; }
p { margin: 0 0 1rem; color: #444; }
.cta { display: inline-block; padding: 0.6rem 1.25rem; border-radius: 6px; background: #111; color: #fff;
       text-decoration: none; font-weight: 600; margin-right: 0.75rem; }
.cta.secondary { background: #eee; color: #111; }
ul.section-list { padding-left: 1.25rem; }
footer { padding: 2rem 1.5rem; text-align: center; color: #777; font-size: 0.875rem; }
"""

_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    slug = _NON_SLUG_CHARS.sub("-", text.lower()).strip("-")
    return slug or "page"


def _page_path(slug: str) -> str:
    """A page's file path within the build output. The home page
    (empty slug) is the root `index.html`; every other page gets its
    own directory with an `index.html` so provider hosts that only
    serve directory-index files (every one targeted here) resolve
    clean paths without a `.html` extension.

    Runs every slug through `_slugify` (not just `.strip("/")`) — a page
    slug can originate from an operator-editable field or raw LLM
    output (see modules/sitemaps/schemas.py), so without this a slug
    like `../../../etc` would produce a build-artifact path that escapes
    the intended output directory, which the traditional (FTP) provider
    would then `cwd`/`mkd` into on the customer's real hosting account."""
    clean = _slugify(slug.strip("/")) if slug.strip("/") else ""
    return "index.html" if not clean else f"{clean}/index.html"


def _esc(value: object) -> str:
    return html.escape(str(value)) if value is not None else ""


def _render_links(items: list[dict], css_class: str = "") -> str:
    parts = []
    for item in items or []:
        label = item.get("label")
        href = item.get("href")
        if not label or not href:
            continue
        cls = css_class
        if item.get("variant") and item["variant"] != "primary":
            cls = f"{css_class} secondary".strip()
        parts.append(f'<a class="{_esc(cls)}" href="{_esc(href)}">{_esc(label)}</a>')
    return "".join(parts)


def _render_nav(navigation: dict) -> str:
    links = (navigation or {}).get("config", {}).get("links", [])
    return f"<nav>{_render_links(links)}</nav>" if links else ""


def _render_footer(footer: dict) -> str:
    config = (footer or {}).get("config", {})
    text = config.get("text") or config.get("copyright")
    links = config.get("links", [])
    parts = []
    if text:
        parts.append(f"<p>{_esc(text)}</p>")
    if links:
        parts.append(_render_links(links))
    return f"<footer>{''.join(parts)}</footer>" if parts else ""


def _render_section(section: dict) -> str:
    """
    A single generic renderer covers every section type rather than one
    branch per `packages/site-templates` component — it only ever
    surfaces fields that are actually present (heading/subheading/body/
    items/CTAs), so an unrecognised or sparsely-configured section still
    renders honestly instead of being skipped or guessed at.
    """
    config = section.get("config", {}) or {}
    section_type = section.get("type", "section")
    parts = [f'<section data-section-type="{_esc(section_type)}">']

    heading = config.get("heading") or config.get("title")
    if heading:
        parts.append(f"<h1>{_esc(heading)}</h1>")

    subheading = config.get("subheading") or config.get("subtitle")
    if subheading:
        parts.append(f"<p>{_esc(subheading)}</p>")

    body = config.get("body") or config.get("description")
    if body:
        parts.append(f"<p>{_esc(body)}</p>")

    ctas = [c for c in (config.get("primaryCta"), config.get("secondaryCta")) if c]
    if ctas:
        parts.append(_render_links(ctas, "cta"))

    items = config.get("items") or []
    if items and isinstance(items, list):
        list_items = []
        for item in items:
            if isinstance(item, dict):
                text = item.get("heading") or item.get("title") or item.get("question") or item.get("label")
                detail = item.get("body") or item.get("description") or item.get("answer")
                if text:
                    list_items.append(f"<li><strong>{_esc(text)}</strong>{f' — {_esc(detail)}' if detail else ''}</li>")
            elif item:
                list_items.append(f"<li>{_esc(item)}</li>")
        if list_items:
            parts.append(f'<ul class="section-list">{"".join(list_items)}</ul>')

    parts.append("</section>")
    return "".join(parts)


def build_static_site(bundle: DeploymentBundle) -> BuildArtifact:
    """
    The shared build step every real provider uses (see
    `DeploymentProvider.build`'s default). Fails cleanly — `ok=False`
    with no files — when the bundle has nothing to publish, so a
    provider never gets asked to deploy an empty artifact.
    """
    pages = (bundle.config or {}).get("pages") or []
    if not pages:
        return BuildArtifact(ok=False, error="No pages in the site bundle to build")

    navigation = (bundle.config or {}).get("navigation") or {}
    footer = (bundle.config or {}).get("footer") or {}
    nav_html = _render_nav(navigation)
    footer_html = _render_footer(footer)

    files: dict[str, str] = {"assets/styles.css": _STYLESHEET}
    missing_information: list[str] = []
    entry_page: str | None = None

    for page in pages:
        slug = page.get("slug", "")
        seo = page.get("seo") or {}
        title = seo.get("title") or page.get("name") or bundle.business_slug
        meta_description = seo.get("meta_description")
        sections = page.get("sections") or []
        if not sections:
            missing_information.append(f"Page '{page.get('name', slug)}' has no sections to build")

        body_sections = "".join(_render_section(s) for s in sections)
        meta_tag = f'<meta name="description" content="{_esc(meta_description)}">' if meta_description else ""
        page_html = (
            "<!doctype html>\n"
            f'<html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">'
            f"{meta_tag}<title>{_esc(title)}</title>"
            f'<link rel="stylesheet" href="/assets/styles.css"></head>'
            f"<body>{nav_html}<main>{body_sections}</main>{footer_html}</body></html>\n"
        )
        path = _page_path(slug)
        files[path] = page_html
        if slug == "" or entry_page is None:
            entry_page = path
            if slug == "":
                entry_page = path

    return BuildArtifact(ok=True, files=files, entry_page=entry_page or "index.html", missing_information=missing_information)
