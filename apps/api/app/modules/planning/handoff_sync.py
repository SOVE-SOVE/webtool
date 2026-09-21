"""
What a Planning Build Brief hands to a Project, and how later Planning
changes reach it (docs/05_DECISIONS.md).

Two jobs, one set of derivations so they can never drift apart:

1. *Handoff* — `create_project_from_planning` seeds the Project's Sitemap,
   CreativeDirectionBrief and DesignBrief fields from the approved
   snapshot.
2. *Re-sync* — re-approving the Build Brief after that handoff pushes
   whatever Planning changed since to the same Project rows, instead of
   silently dropping it.

The re-sync is a 3-way merge per field: Planning's new value, the
Project's current value, and `baseline` — the last value Planning handed
over (stored on the approved brief as `handoff_baseline`). The Project's
current value is left alone whenever the Project has its own edit:

- Planning unchanged since the baseline  -> nothing to do (no conflict, even
  if the Project has diverged).
- Project already equals Planning        -> nothing to do; baseline advances.
- Project empty, or still equal to the baseline (untouched) -> take Planning's.
- Otherwise the Project has its own edit -> keep it and FLAG a conflict.

The baseline only advances for a field when its change is applied (or the
two already agree), so an unresolved conflict stays flagged on later syncs.
An approved Project artefact is never changed by a sync — that would
bypass its approval — so those changes are flagged too, as is a sitemap the
Project has since regenerated.
"""

import re
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import planning_visual_directions as planning_visual_directions_agent
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.design_briefs.models import BriefStatus, DesignBrief
from app.modules.projects.models import Project
from app.modules.sitemaps.models import NavPlacement, PageType, Sitemap, SitemapPage, SitemapStatus

_NOT_GENERATED_FROM_PLANNING = "Not generated from Planning — regenerate this Creative Direction on the project to fill it in."

_VALUE_PREVIEW_LIMIT = 300

# Only the fields Planning actually writes to the Project (in display order).
DESIGN_BRIEF_LABELS = {
    "logo_assets": "Logo assets",
    "image_assets": "Image assets",
    "services_content": "Services content",
    "about_content": "About content",
    "faqs": "FAQs",
    "calls_to_action": "Calls to action",
    "business_description": "Business description",
}
CREATIVE_DIRECTION_LABELS = {
    "creative_concept": "Creative concept",
    "visual_direction": "Visual direction",
    "colour_direction": "Colour direction",
    "typography_direction": "Typography direction",
    "image_direction": "Image direction",
    "layout_direction": "Layout direction",
}
SITEMAP_PAGE_LABELS = {
    "page_type": "Page type",
    "purpose": "Purpose",
    "key_sections": "Key sections",
    "seo_title": "SEO title",
    "seo_meta_description": "SEO meta description",
}


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug or "page"


# --- Derivations: snapshot -> the values Planning hands to the Project -----------


def _asset_notes(assets_snapshot: list[dict], category: str) -> str:
    return "\n".join(
        f"{a['label']} — {a['status']}" + (f": {a['note']}" if a.get("note") else "")
        for a in assets_snapshot
        if a["category"] == category
    )


def derive_design_brief_fields(assets_snapshot: list[dict], content_draft_snapshot: list[dict]) -> dict[str, str]:
    """The DesignBrief fields Planning fills, keyed by column — only the
    non-empty ones. Content Draft copy lands in the exact verbatim-text
    fields agents/website_generator.py already parses ("Title — Description"
    lines for services, "Question? Answer" lines for FAQs), so the real,
    unchanged generator turns it into sections."""
    fields: dict[str, str] = {}

    logo = _asset_notes(assets_snapshot, "logo")
    if logo:
        fields["logo_assets"] = logo
    images = "\n".join(
        filter(None, [_asset_notes(assets_snapshot, "photos"), _asset_notes(assets_snapshot, "portfolio_images")])
    )
    if images:
        fields["image_assets"] = images

    service_lines: list[str] = []
    faq_lines: list[str] = []
    cta_lines: list[str] = []
    about_body: str | None = None
    hero_subheading: str | None = None

    for page in content_draft_snapshot:
        for section in page.get("sections", []):
            content = section.get("content") or {}
            section_type = section.get("section_type")
            if section_type == "serviceCards":
                for service in content.get("services", []):
                    title = service.get("title", "")
                    description = service.get("description", "")
                    service_lines.append(f"{title} — {description}" if description else title)
            elif section_type == "about" and about_body is None:
                about_body = content.get("body")
            elif section_type == "faq":
                for item in content.get("items", []):
                    question = item.get("question", "").rstrip("?")
                    answer = item.get("answer", "")
                    if question and answer:
                        faq_lines.append(f"{question}? {answer}")
            elif section_type == "cta":
                label = content.get("label") or content.get("heading")
                if label:
                    cta_lines.append(label)
            elif section_type == "hero" and hero_subheading is None:
                hero_subheading = content.get("subheading")

    if service_lines:
        fields["services_content"] = "\n".join(service_lines)
    if about_body:
        fields["about_content"] = about_body
    if faq_lines:
        fields["faqs"] = "\n".join(faq_lines)
    if cta_lines:
        fields["calls_to_action"] = "\n".join(cta_lines)
    if hero_subheading:
        fields["business_description"] = hero_subheading
    return fields


def derive_sitemap_page(page: dict, content_by_title: dict[str, dict]) -> dict[str, str]:
    """One proposed page's values on the Project's SitemapPage. When an
    approved Content Draft page exists for the title, its SEO title/meta
    ride along (see agents/website_generator.py's _build_seo precedence)."""
    try:
        page_type = PageType(page.get("page_type", "custom"))
    except ValueError:
        page_type = PageType.CUSTOM
    content_page = content_by_title.get(page["title"])
    return {
        "page_type": page_type.value,
        "purpose": page.get("purpose") or page.get("reason") or "",
        "key_sections": "\n".join(page.get("key_sections") or []),
        "seo_title": (content_page.get("seo_title") if content_page else None) or "",
        "seo_meta_description": (content_page.get("seo_meta_description") if content_page else None) or "",
    }


def derive_sitemap_pages(pages_snapshot: list[dict], content_draft_snapshot: list[dict]) -> dict[str, dict[str, str]]:
    content_by_title = {p["title"]: p for p in (content_draft_snapshot or [])}
    return {page["title"]: derive_sitemap_page(page, content_by_title) for page in pages_snapshot}


def derive_creative_direction_fields(direction: dict | None) -> dict[str, str]:
    if not direction:
        return {}
    return {
        "creative_concept": direction.get("character", ""),
        "visual_direction": direction.get("character", ""),
        "colour_direction": direction.get("colour_palette", ""),
        "typography_direction": direction.get("typography", ""),
        "image_direction": direction.get("imagery", ""),
        "layout_direction": direction.get("layout", ""),
    }


def derive_state(
    assets_snapshot: list[dict],
    content_draft_snapshot: list[dict],
    sitemap_snapshot: list[dict],
    visual_direction_snapshot: dict | None,
) -> dict:
    """Everything Planning hands to the Project, in the shape the baseline
    is stored in (minus the build-direction narrative, which the service
    builds)."""
    return {
        "design_brief": derive_design_brief_fields(assets_snapshot, content_draft_snapshot),
        "sitemap": derive_sitemap_pages(sitemap_snapshot, content_draft_snapshot),
        "creative_direction": derive_creative_direction_fields(visual_direction_snapshot),
    }


def initial_baseline(approved, narrative: str) -> dict:
    """The baseline recorded when the Project is first created."""
    return {
        **derive_state(
            approved.assets_snapshot,
            approved.content_draft_snapshot,
            approved.sitemap_snapshot,
            approved.visual_direction_snapshot,
        ),
        "build_direction": narrative,
    }


# --- Creating the Project rows (handoff) ------------------------------------------


def create_sitemap_from_snapshot(
    db: Session, project_id: uuid.UUID, pages_snapshot: list[dict], content_draft_snapshot: list[dict] | None = None
) -> Sitemap | None:
    """Real Sitemap + SitemapPage rows from the approved brief's sitemap
    snapshot — goes through the project's normal approve_sitemap gate
    afterward, unchanged. DRAFT, no creative_direction_id yet."""
    if not pages_snapshot:
        return None
    sitemap = Sitemap(project_id=project_id, status=SitemapStatus.DRAFT, overview=None)
    db.add(sitemap)
    db.flush()

    content_by_title = {p["title"]: p for p in (content_draft_snapshot or [])}
    seen_slugs: set[str] = set()
    for order_index, page in enumerate(pages_snapshot):
        slug = _unique_slug(page["title"], seen_slugs)
        seen_slugs.add(slug)
        values = derive_sitemap_page(page, content_by_title)
        db.add(
            SitemapPage(
                sitemap_id=sitemap.id,
                title=page["title"],
                slug=slug,
                page_type=PageType(values["page_type"]),
                nav_placement=NavPlacement.PRIMARY_NAV,
                order_index=order_index,
                purpose=values["purpose"],
                key_sections=values["key_sections"],
                seo_title=values["seo_title"] or None,
                seo_meta_description=values["seo_meta_description"] or None,
            )
        )
    db.flush()
    return sitemap


def create_creative_direction_from_snapshot(
    db: Session, project_id: uuid.UUID, direction: dict | None
) -> CreativeDirectionBrief | None:
    """A real DRAFT CreativeDirectionBrief from the approved brief's
    selected visual direction — goes through the project's normal
    approve_creative_direction gate afterward, unchanged. Fields with no
    Planning-sourced analog get an honest placeholder rather than an
    invented one."""
    if not direction:
        return None
    values = derive_creative_direction_fields(direction)
    brief = CreativeDirectionBrief(
        project_id=project_id,
        status=CreativeDirectionStatus.DRAFT,
        facts=_NOT_GENERATED_FROM_PLANNING,
        assumptions=_NOT_GENERATED_FROM_PLANNING,
        brand_personality=_NOT_GENERATED_FROM_PLANNING,
        ux_direction=_NOT_GENERATED_FROM_PLANNING,
        tone_of_voice=_NOT_GENERATED_FROM_PLANNING,
        visual_hierarchy=_NOT_GENERATED_FROM_PLANNING,
        cta_strategy=_NOT_GENERATED_FROM_PLANNING,
        things_to_avoid=_NOT_GENERATED_FROM_PLANNING,
        references_inspiration=_NOT_GENERATED_FROM_PLANNING,
        sources_note="Selected in Planning's Build Brief (Visual Direction Choices).",
        model_used="planning_build_brief",
        prompt_version=planning_visual_directions_agent.PROMPT_VERSION,
        **values,
    )
    db.add(brief)
    db.flush()
    return brief


def seed_sitemap_and_creative_direction(db: Session, project_id: uuid.UUID, approved) -> None:
    """Idempotent handoff seeding: creates the Project's Planning sitemap /
    creative direction only if the Project has none yet, and records their
    ids on the approved brief (the sync's way of finding them later).

    "Create project" can land on a Project that already has its own — a
    prospect project the operator started earlier — or on one a previous,
    interrupted handoff already seeded. Either way a second row would just
    become the Project's "latest" and supersede the first, so it's skipped.
    A skipped artefact leaves the recorded id alone: still pointing at the
    seeded row after an interrupted handoff, still empty when the Project's
    own row is what's there (a later sync then flags rather than edits it)."""
    if db.scalar(select(Sitemap.id).where(Sitemap.project_id == project_id).limit(1)) is None:
        sitemap = create_sitemap_from_snapshot(db, project_id, approved.sitemap_snapshot, approved.content_draft_snapshot)
        approved.seeded_sitemap_id = sitemap.id if sitemap else None
    if db.scalar(select(CreativeDirectionBrief.id).where(CreativeDirectionBrief.project_id == project_id).limit(1)) is None:
        direction = create_creative_direction_from_snapshot(db, project_id, approved.visual_direction_snapshot)
        approved.seeded_creative_direction_id = direction.id if direction else None


def apply_to_design_brief(db: Session, project_id: uuid.UUID, fields: dict[str, str]) -> None:
    """Get-or-creates the project's DesignBrief and fills the given fields,
    only where they're still empty — never overwriting an operator-entered
    value on the Project side."""
    brief = db.scalar(select(DesignBrief).where(DesignBrief.project_id == project_id))
    if brief is None:
        brief = DesignBrief(project_id=project_id, status=BriefStatus.DRAFT)
        db.add(brief)
        db.flush()
    for name, value in fields.items():
        if not getattr(brief, name):
            setattr(brief, name, value)


def _unique_slug(title: str, taken: set[str]) -> str:
    slug = slugify(title)
    n = 2
    while slug in taken:
        slug = f"{slugify(title)}-{n}"
        n += 1
    return slug


# --- Re-sync -------------------------------------------------------------------------


@dataclass
class _Sync:
    conflicts: list[dict] = field(default_factory=list)
    applied: int = 0

    def conflict(self, area: str, item: str, planning_value: str, project_value: str, message: str) -> None:
        self.conflicts.append(
            {
                "area": area,
                "item": item,
                "planning_value": _preview(planning_value),
                "project_value": _preview(project_value),
                "message": message,
            }
        )


def _preview(value: str) -> str:
    value = value or ""
    return value if len(value) <= _VALUE_PREVIEW_LIMIT else value[: _VALUE_PREVIEW_LIMIT - 1] + "…"


_EDITED = "Planning changed this, but the project has its own edit — the project's version was kept."


def _decide(current: str, base: str, plan: str) -> tuple[str, str]:
    """(decision, new baseline) for one field — the 3-way rule in the module
    docstring. `decision` is "keep", "set" or "conflict"."""
    if plan == base:
        return "keep", base
    if current == plan:
        return "keep", plan
    if current == "" or current == base:
        return "set", plan
    return "conflict", base


def _set_or_drop(mapping: dict, key: str, value: str) -> None:
    if value:
        mapping[key] = value
    else:
        mapping.pop(key, None)


def _sync_design_brief(db: Session, project: Project, plan: dict, base: dict, sync: _Sync) -> dict:
    new_base = dict(base)
    brief = db.scalar(select(DesignBrief).where(DesignBrief.project_id == project.id))
    locked = brief is not None and brief.status == BriefStatus.APPROVED
    for name, label in DESIGN_BRIEF_LABELS.items():
        plan_value, base_value = plan.get(name, ""), base.get(name, "")
        current = (getattr(brief, name) or "") if brief is not None else ""
        decision, next_base = _decide(current, base_value, plan_value)
        message = _EDITED
        if decision == "set" and locked:
            decision, next_base = "conflict", base_value
            message = "The project's client brief is already approved — Planning's change wasn't applied."
        if decision == "set":
            if brief is None:
                brief = DesignBrief(project_id=project.id, status=BriefStatus.DRAFT)
                db.add(brief)
                db.flush()
            setattr(brief, name, plan_value or None)
            sync.applied += 1
        elif decision == "conflict":
            sync.conflict("Client brief", label, plan_value, current, message)
        _set_or_drop(new_base, name, next_base)
    return new_base


def _sync_creative_direction(db: Session, project: Project, approved, plan: dict, base: dict, sync: _Sync) -> dict:
    if plan == base:
        return base
    direction = db.get(CreativeDirectionBrief, approved.seeded_creative_direction_id) if approved.seeded_creative_direction_id else None

    if direction is None:
        has_any = db.scalar(select(CreativeDirectionBrief.id).where(CreativeDirectionBrief.project_id == project.id).limit(1))
        if approved.seeded_creative_direction_id is None and not base and plan and has_any is None:
            created = create_creative_direction_from_snapshot(db, project.id, approved.visual_direction_snapshot)
            approved.seeded_creative_direction_id = created.id
            sync.applied += 1
            return plan
        sync.conflict(
            "Creative direction",
            "Visual direction",
            plan.get("visual_direction", ""),
            "",
            "The project has no Planning-created creative direction to update (it has its own, or it was removed) — Planning's change wasn't applied.",
        )
        return base

    new_base = dict(base)
    locked = direction.status == CreativeDirectionStatus.APPROVED
    for name, label in CREATIVE_DIRECTION_LABELS.items():
        plan_value, base_value = plan.get(name, ""), base.get(name, "")
        current = getattr(direction, name) or ""
        decision, next_base = _decide(current, base_value, plan_value)
        message = _EDITED
        if decision == "set" and locked:
            decision, next_base = "conflict", base_value
            message = "The project's creative direction is already approved — Planning's change wasn't applied."
        if decision == "set":
            setattr(direction, name, plan_value)
            sync.applied += 1
        elif decision == "conflict":
            sync.conflict("Creative direction", label, plan_value, current, message)
        _set_or_drop(new_base, name, next_base)
    return new_base


def _page_values(page: SitemapPage) -> dict[str, str]:
    return {
        "page_type": page.page_type.value,
        "purpose": page.purpose or "",
        "key_sections": page.key_sections or "",
        "seo_title": page.seo_title or "",
        "seo_meta_description": page.seo_meta_description or "",
    }


def _set_page_value(page: SitemapPage, name: str, value: str) -> None:
    if name == "page_type":
        page.page_type = PageType(value)
    elif name == "purpose":
        page.purpose = value
    else:
        setattr(page, name, value or None)


def _sync_sitemap(db: Session, project: Project, approved, plan: dict, base: dict, sync: _Sync) -> dict:
    if plan == base:
        return base
    changed_titles = [t for t in {*plan, *base} if plan.get(t) != base.get(t)]
    sitemap = db.get(Sitemap, approved.seeded_sitemap_id) if approved.seeded_sitemap_id else None

    if sitemap is None:
        has_any = db.scalar(select(Sitemap.id).where(Sitemap.project_id == project.id).limit(1))
        if approved.seeded_sitemap_id is None and not base and plan and has_any is None:
            created = create_sitemap_from_snapshot(db, project.id, approved.sitemap_snapshot, approved.content_draft_snapshot)
            approved.seeded_sitemap_id = created.id
            sync.applied += len(plan)
            return plan
        sync.conflict(
            "Sitemap",
            "Planning sitemap",
            f"{len(plan)} page(s)",
            "",
            "The project has no Planning-created sitemap to update (it has its own, or it was removed) — Planning's change wasn't applied.",
        )
        return base

    latest = db.scalar(select(Sitemap).where(Sitemap.project_id == project.id).order_by(Sitemap.generated_at.desc()))
    if latest is not None and latest.id != sitemap.id:
        sync.conflict(
            "Sitemap",
            "Planning sitemap",
            f"{len(plan)} page(s)",
            f"{len(latest.pages)} page(s)",
            f"The project has since regenerated its sitemap — {len(changed_titles)} Planning page change(s) weren't applied.",
        )
        return base
    if sitemap.status == SitemapStatus.APPROVED:
        sync.conflict(
            "Sitemap",
            "Planning sitemap",
            f"{len(plan)} page(s)",
            f"{len(sitemap.pages)} page(s)",
            f"The project's sitemap is already approved — {len(changed_titles)} Planning page change(s) weren't applied.",
        )
        return base

    new_base = {title: dict(values) for title, values in base.items()}
    pages = {p.title: p for p in sitemap.pages}
    taken_slugs = {p.slug for p in sitemap.pages}

    for title, plan_values in plan.items():
        base_values = base.get(title)
        page = pages.get(title)
        if base_values is None:  # a page Planning added since the last sync
            if page is None:
                slug = _unique_slug(title, taken_slugs)
                taken_slugs.add(slug)
                sitemap.pages.append(
                    SitemapPage(
                        title=title,
                        slug=slug,
                        page_type=PageType(plan_values["page_type"]),
                        nav_placement=NavPlacement.PRIMARY_NAV,
                        order_index=max((p.order_index for p in sitemap.pages), default=-1) + 1,
                        purpose=plan_values["purpose"],
                        key_sections=plan_values["key_sections"],
                        seo_title=plan_values["seo_title"] or None,
                        seo_meta_description=plan_values["seo_meta_description"] or None,
                    )
                )
                sync.applied += 1
            new_base[title] = dict(plan_values)  # already on the project either way
            continue
        if plan_values == base_values:
            continue
        if page is None:
            sync.conflict("Sitemap", title, title, "", "Planning changed this page, but it was removed from the project's sitemap.")
            continue
        current = _page_values(page)
        page_base = dict(base_values)
        for name, label in SITEMAP_PAGE_LABELS.items():
            decision, next_base = _decide(current[name], base_values.get(name, ""), plan_values.get(name, ""))
            if decision == "set":
                _set_page_value(page, name, plan_values.get(name, ""))
                sync.applied += 1
            elif decision == "conflict":
                sync.conflict("Sitemap", f"{title} — {label}", plan_values.get(name, ""), current[name], _EDITED)
            page_base[name] = next_base
        new_base[title] = page_base

    for title, base_values in base.items():
        if title in plan:
            continue
        page = pages.get(title)
        if page is None:  # already gone from the project too
            new_base.pop(title, None)
        elif _page_values(page) == base_values:  # untouched on the project — follow Planning
            sitemap.pages.remove(page)
            sync.applied += 1
            new_base.pop(title, None)
        else:
            sync.conflict(
                "Sitemap",
                title,
                "(removed)",
                page.purpose or "",
                "Planning removed this page, but the project has its own edit — the page was kept.",
            )
    return new_base


def _sync_build_direction(project: Project, plan: str, base: str, sync: _Sync) -> str:
    current = project.build_direction or ""
    decision, next_base = _decide(current, base, plan)
    if decision == "set":
        project.build_direction = plan or None
        sync.applied += 1
    elif decision == "conflict":
        sync.conflict("Build direction", "Planning narrative", plan, current, _EDITED)
    return next_base


def sync_to_project(db: Session, project: Project, approved, *, narrative: str, baseline: dict) -> tuple[int, int]:
    """Pushes Planning's current approved snapshot to the Project it was
    handed to, per the module docstring. Updates `approved.handoff_baseline`,
    `approved.sync_conflicts` and the seeded-row ids in place; the caller
    commits. Returns (changes applied, conflicts flagged)."""
    plan = derive_state(
        approved.assets_snapshot,
        approved.content_draft_snapshot,
        approved.sitemap_snapshot,
        approved.visual_direction_snapshot,
    )
    sync = _Sync()
    approved.handoff_baseline = {
        "design_brief": _sync_design_brief(db, project, plan["design_brief"], baseline.get("design_brief", {}), sync),
        "sitemap": _sync_sitemap(db, project, approved, plan["sitemap"], baseline.get("sitemap", {}), sync),
        "creative_direction": _sync_creative_direction(
            db, project, approved, plan["creative_direction"], baseline.get("creative_direction", {}), sync
        ),
        "build_direction": _sync_build_direction(project, narrative, baseline.get("build_direction") or "", sync),
    }
    approved.sync_conflicts = sync.conflicts
    return sync.applied, len(sync.conflicts)
