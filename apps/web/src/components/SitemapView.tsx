"use client";

import { useState } from "react";
import {
  api,
  NAV_PLACEMENTS,
  PAGE_TYPES,
  type NavPlacement,
  type PageType,
  type Sitemap,
  type SitemapPage,
  type SitemapPageCreate,
  type SitemapPageUpdate,
} from "@/lib/api";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toLines(items: string[]): string {
  return items.join("\n");
}

function fromLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const PAGE_TYPE_LABELS: Record<PageType, string> = {
  home: "Home",
  about: "About",
  services: "Services",
  service_detail: "Service detail",
  products: "Products",
  product_detail: "Product detail",
  contact: "Contact",
  faq: "FAQ",
  testimonials: "Testimonials",
  portfolio: "Portfolio",
  blog: "Blog",
  blog_post: "Blog post",
  custom: "Custom",
};

const NAV_PLACEMENT_LABELS: Record<NavPlacement, string> = {
  primary_nav: "Primary nav",
  footer_nav: "Footer nav",
  primary_and_footer: "Primary + footer",
  not_in_nav: "Not in nav",
};

type PageFormValue = {
  title: string;
  slug: string;
  page_type: PageType;
  nav_placement: NavPlacement;
  purpose: string;
  primary_cta: string;
  secondary_cta: string;
  key_sections: string;
  required_content: string;
  required_functionality: string;
};

const EMPTY_FORM: PageFormValue = {
  title: "",
  slug: "",
  page_type: "custom",
  nav_placement: "primary_nav",
  purpose: "",
  primary_cta: "",
  secondary_cta: "",
  key_sections: "",
  required_content: "",
  required_functionality: "",
};

function formFromPage(page: SitemapPage): PageFormValue {
  return {
    title: page.title,
    slug: page.slug,
    page_type: page.page_type,
    nav_placement: page.nav_placement,
    purpose: page.purpose,
    primary_cta: page.primary_cta ?? "",
    secondary_cta: page.secondary_cta ?? "",
    key_sections: toLines(page.key_sections),
    required_content: toLines(page.required_content),
    required_functionality: toLines(page.required_functionality),
  };
}

function PageForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  saving,
  submitLabel,
}: {
  value: PageFormValue;
  onChange: (v: PageFormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  submitLabel: string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-subtle p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="text-fg-muted">Title</span>
          <input
            value={value.title}
            onChange={(e) => {
              const title = e.target.value;
              onChange({ ...value, title, slug: value.slug || slugify(title) });
            }}
            className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-fg-muted">Slug</span>
          <input
            value={value.slug}
            onChange={(e) => onChange({ ...value, slug: e.target.value })}
            className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="text-fg-muted">Page type</span>
          <select
            value={value.page_type}
            onChange={(e) => onChange({ ...value, page_type: e.target.value as PageType })}
            className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
          >
            {PAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAGE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-fg-muted">Navigation</span>
          <select
            value={value.nav_placement}
            onChange={(e) => onChange({ ...value, nav_placement: e.target.value as NavPlacement })}
            className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
          >
            {NAV_PLACEMENTS.map((p) => (
              <option key={p} value={p}>
                {NAV_PLACEMENT_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-fg-muted">Purpose</span>
        <textarea
          value={value.purpose}
          onChange={(e) => onChange({ ...value, purpose: e.target.value })}
          rows={2}
          className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="text-fg-muted">Primary CTA</span>
          <input
            value={value.primary_cta}
            onChange={(e) => onChange({ ...value, primary_cta: e.target.value })}
            className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-fg-muted">Secondary CTA</span>
          <input
            value={value.secondary_cta}
            onChange={(e) => onChange({ ...value, secondary_cta: e.target.value })}
            className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-fg-muted">Key sections (one per line)</span>
        <textarea
          value={value.key_sections}
          onChange={(e) => onChange({ ...value, key_sections: e.target.value })}
          rows={2}
          className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="text-fg-muted">Required content (one per line)</span>
        <textarea
          value={value.required_content}
          onChange={(e) => onChange({ ...value, required_content: e.target.value })}
          rows={2}
          className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="text-fg-muted">Required functionality (one per line)</span>
        <textarea
          value={value.required_functionality}
          onChange={(e) => onChange({ ...value, required_functionality: e.target.value })}
          rows={2}
          className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
        />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={saving || !value.title || !value.slug}
          className="btn btn-primary"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

function bulletList(items: string[]) {
  if (items.length === 0) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function PageRow({
  page,
  depth,
  siblings,
  sitemapId,
  approved,
  onChange,
  setError,
}: {
  page: SitemapPage;
  depth: number;
  siblings: SitemapPage[];
  sitemapId: string;
  approved: boolean;
  onChange: (s: Sitemap) => void;
  setError: (e: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [editing, setEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [draft, setDraft] = useState<PageFormValue>(() => formFromPage(page));
  const [newChild, setNewChild] = useState<PageFormValue>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const index = siblings.findIndex((s) => s.id === page.id);
  const canMoveUp = index > 0;
  const canMoveDown = index >= 0 && index < siblings.length - 1;

  function startEdit() {
    setDraft(formFromPage(page));
    setEditing(true);
    setExpanded(true);
  }

  async function saveEdit() {
    setSaving(true);
    setError(null);
    try {
      const update: SitemapPageUpdate = {
        title: draft.title,
        slug: draft.slug,
        page_type: draft.page_type,
        nav_placement: draft.nav_placement,
        purpose: draft.purpose,
        primary_cta: draft.primary_cta || null,
        secondary_cta: draft.secondary_cta || null,
        key_sections: fromLines(draft.key_sections),
        required_content: fromLines(draft.required_content),
        required_functionality: fromLines(draft.required_functionality),
      };
      const updated = await api.updateSitemapPage(sitemapId, page.id, update);
      onChange(updated);
      setEditing(false);
    } catch {
      setError("Couldn't save this page.");
    } finally {
      setSaving(false);
    }
  }

  async function removePage() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.deleteSitemapPage(sitemapId, page.id);
      onChange(updated);
    } catch {
      setError("Couldn't remove this page.");
      setSaving(false);
    }
  }

  async function move(direction: "up" | "down") {
    const otherIndex = direction === "up" ? index - 1 : index + 1;
    const other = siblings[otherIndex];
    if (!other) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.reorderSitemapPages(sitemapId, [
        { id: page.id, order_index: other.order_index },
        { id: other.id, order_index: page.order_index },
      ]);
      onChange(updated);
    } catch {
      setError("Couldn't reorder pages.");
    } finally {
      setSaving(false);
    }
  }

  async function submitAddChild() {
    setSaving(true);
    setError(null);
    try {
      const create: SitemapPageCreate = {
        title: newChild.title,
        slug: newChild.slug,
        page_type: newChild.page_type,
        parent_page_id: page.id,
        nav_placement: newChild.nav_placement,
        purpose: newChild.purpose,
        primary_cta: newChild.primary_cta || null,
        secondary_cta: newChild.secondary_cta || null,
        key_sections: fromLines(newChild.key_sections),
        required_content: fromLines(newChild.required_content),
        required_functionality: fromLines(newChild.required_functionality),
      };
      const updated = await api.addSitemapPage(sitemapId, create);
      onChange(updated);
      setNewChild(EMPTY_FORM);
      setAddingChild(false);
      setExpanded(true);
    } catch {
      setError("Couldn't add this page.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="py-2" style={{ marginLeft: depth * 20 }}>
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => setExpanded((v) => !v)} className="flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg">
              {expanded ? "▾" : "▸"} {page.title}
            </span>
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs text-fg-muted">
              /{page.slug}
            </span>
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs text-fg-muted">
              {PAGE_TYPE_LABELS[page.page_type]}
            </span>
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs text-fg-muted">
              {NAV_PLACEMENT_LABELS[page.nav_placement]}
            </span>
          </div>
        </button>
        {!approved && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => move("up")}
              disabled={!canMoveUp || saving}
              title="Move up"
              className="rounded border border-border-strong px-1.5 py-0.5 text-xs hover:bg-surface-subtle disabled:opacity-30"
            >
              ↑
            </button>
            <button
              onClick={() => move("down")}
              disabled={!canMoveDown || saving}
              title="Move down"
              className="rounded border border-border-strong px-1.5 py-0.5 text-xs hover:bg-surface-subtle disabled:opacity-30"
            >
              ↓
            </button>
            <button
              onClick={startEdit}
              disabled={saving}
              className="rounded border border-border-strong px-2 py-0.5 text-xs hover:bg-surface-subtle disabled:opacity-50"
            >
              Edit
            </button>
            <button
              onClick={() => setAddingChild((v) => !v)}
              disabled={saving}
              className="rounded border border-border-strong px-2 py-0.5 text-xs hover:bg-surface-subtle disabled:opacity-50"
            >
              + Sub-page
            </button>
            <button
              onClick={removePage}
              disabled={saving}
              className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {expanded && !editing && (
        <div className="mt-2 space-y-1.5 pl-1 text-sm text-fg-muted">
          <p>{page.purpose}</p>
          <p>
            <span className="text-fg-muted">Primary CTA: </span>
            {page.primary_cta || "—"}
            {page.secondary_cta && (
              <>
                <span className="ml-3 text-fg-muted">Secondary CTA: </span>
                {page.secondary_cta}
              </>
            )}
          </p>
          {page.key_sections.length > 0 && (
            <div>
              <span className="text-fg-muted">Key sections:</span>
              {bulletList(page.key_sections)}
            </div>
          )}
          {page.required_content.length > 0 && (
            <div>
              <span className="text-fg-muted">Required content:</span>
              {bulletList(page.required_content)}
            </div>
          )}
          {page.required_functionality.length > 0 && (
            <div>
              <span className="text-fg-muted">Required functionality:</span>
              {bulletList(page.required_functionality)}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-2">
          <PageForm
            value={draft}
            onChange={setDraft}
            onSubmit={saveEdit}
            onCancel={() => setEditing(false)}
            saving={saving}
            submitLabel="Save changes"
          />
        </div>
      )}

      {addingChild && (
        <div className="mt-2">
          <PageForm
            value={newChild}
            onChange={setNewChild}
            onSubmit={submitAddChild}
            onCancel={() => setAddingChild(false)}
            saving={saving}
            submitLabel="Add sub-page"
          />
        </div>
      )}

      {page.children.length > 0 && (
        <ul className="mt-1 divide-y divide-border border-l border-border">
          {page.children.map((child) => (
            <PageRow
              key={child.id}
              page={child}
              depth={depth + 1}
              siblings={page.children}
              sitemapId={sitemapId}
              approved={approved}
              onChange={onChange}
              setError={setError}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SitemapView({ sitemap, onChange }: { sitemap: Sitemap; onChange: (s: Sitemap) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [addingTop, setAddingTop] = useState(false);
  const [newTop, setNewTop] = useState<PageFormValue>(EMPTY_FORM);
  const [savingTop, setSavingTop] = useState(false);

  const approved = sitemap.status === "approved";

  async function handleApprove() {
    setApproving(true);
    setError(null);
    try {
      const updated = await api.approveSitemap(sitemap.id);
      onChange(updated);
    } catch {
      setError("Couldn't approve this sitemap.");
    } finally {
      setApproving(false);
    }
  }

  async function submitAddTop() {
    setSavingTop(true);
    setError(null);
    try {
      const create: SitemapPageCreate = {
        title: newTop.title,
        slug: newTop.slug,
        page_type: newTop.page_type,
        nav_placement: newTop.nav_placement,
        purpose: newTop.purpose,
        primary_cta: newTop.primary_cta || null,
        secondary_cta: newTop.secondary_cta || null,
        key_sections: fromLines(newTop.key_sections),
        required_content: fromLines(newTop.required_content),
        required_functionality: fromLines(newTop.required_functionality),
      };
      const updated = await api.addSitemapPage(sitemap.id, create);
      onChange(updated);
      setNewTop(EMPTY_FORM);
      setAddingTop(false);
    } catch {
      setError("Couldn't add this page.");
    } finally {
      setSavingTop(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              approved ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-surface-subtle text-fg-muted"
            }`}
          >
            {approved ? "Approved — structural source of truth" : "Draft — review before continuing"}
          </span>
          {sitemap.flagged_for_review && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Flagged for review</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!approved && (
            <button
              onClick={() => setAddingTop((v) => !v)}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle"
            >
              {addingTop ? "Cancel" : "Add page"}
            </button>
          )}
          {!approved && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {approving ? "Approving…" : "Approve — continue to build"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-error">{error}</p>}
      {sitemap.review_notes && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
          {sitemap.review_notes}
        </p>
      )}
      {sitemap.overview && <p className="mt-3 text-sm text-fg-muted">{sitemap.overview}</p>}

      {addingTop && (
        <div className="mt-3">
          <PageForm
            value={newTop}
            onChange={setNewTop}
            onSubmit={submitAddTop}
            onCancel={() => setAddingTop(false)}
            saving={savingTop}
            submitLabel="Add page"
          />
        </div>
      )}

      <ul className="mt-3 divide-y divide-border border border-border px-3">
        {sitemap.pages.length === 0 && <li className="py-3 text-sm text-fg-muted">No pages yet.</li>}
        {sitemap.pages.map((page) => (
          <PageRow
            key={page.id}
            page={page}
            depth={0}
            siblings={sitemap.pages}
            sitemapId={sitemap.id}
            approved={approved}
            onChange={onChange}
            setError={setError}
          />
        ))}
      </ul>

      {sitemap.sources_note && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-fg-muted">
          Sources: {sitemap.sources_note}
        </p>
      )}
      <p className="mt-2 text-xs text-fg-subtle">
        Generated {new Date(sitemap.generated_at).toLocaleString()}
        {sitemap.generated_by_user_name ? ` by ${sitemap.generated_by_user_name}` : ""}
        {sitemap.approved_at ? ` · approved ${new Date(sitemap.approved_at).toLocaleString()}` : ""}
        {sitemap.approved_by_user_name ? ` by ${sitemap.approved_by_user_name}` : ""}
      </p>
    </div>
  );
}
