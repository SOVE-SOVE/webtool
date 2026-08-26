"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  CONTENT_TONES,
  type ContentDraft,
  type ContentDraftSummary,
  type ContentPageUpdate,
  type ContentTone,
  type PageContentDraft,
} from "@/lib/api";

type PageEditState = {
  seo_title: string;
  meta_description: string;
  hero_heading: string;
  hero_subheading: string;
  body: string;
  cta_heading: string;
  cta_body: string;
  services: { title: string; description: string }[];
  faqs: { question: string; answer: string }[];
};

function toEditState(page: PageContentDraft): PageEditState {
  return {
    seo_title: page.seo_title ?? "",
    meta_description: page.meta_description ?? "",
    hero_heading: page.hero_heading ?? "",
    hero_subheading: page.hero_subheading ?? "",
    body: page.body ?? "",
    cta_heading: page.cta_heading ?? "",
    cta_body: page.cta_body ?? "",
    services: page.services.map((s) => ({ ...s })),
    faqs: page.faqs.map((f) => ({ ...f })),
  };
}

function toUpdatePayload(state: PageEditState): ContentPageUpdate {
  return {
    seo_title: state.seo_title || null,
    meta_description: state.meta_description || null,
    hero_heading: state.hero_heading || null,
    hero_subheading: state.hero_subheading || null,
    body: state.body || null,
    cta_heading: state.cta_heading || null,
    cta_body: state.cta_body || null,
    services: state.services,
    faqs: state.faqs,
  };
}

export default function ProjectContentPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [versions, setVersions] = useState<ContentDraftSummary[] | null>(null);
  const [draft, setDraft] = useState<ContentDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tone, setTone] = useState<ContentTone>("professional");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [edits, setEdits] = useState<Record<string, PageEditState>>({});
  const [savingPageId, setSavingPageId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function applyDraft(d: ContentDraft) {
    setDraft(d);
    setEdits(Object.fromEntries(d.pages.map((p) => [p.page_id, toEditState(p)])));
  }

  function loadVersions(selectId?: string) {
    api
      .listContentDrafts(projectId)
      .then((list) => {
        setVersions(list);
        const target = selectId ?? list[0]?.id;
        if (target) {
          api.getContentDraft(target).then(applyDraft).catch(() => {});
        } else {
          setDraft(null);
        }
      })
      .catch(() => setLoadError("Couldn't load this project's content drafts."));
  }

  useEffect(() => loadVersions(), [projectId]);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const generated = await api.generateContentDraft(projectId, { tone });
      loadVersions(generated.id);
    } catch (err) {
      setGenerateError(
        err instanceof ApiError
          ? err.message
          : "Couldn't draft content — make sure this project has an approved sitemap with pages first.",
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleSelectVersion(id: string) {
    api.getContentDraft(id).then(applyDraft).catch(() => {});
  }

  async function handleRollback(versionId: string) {
    setRollingBack(true);
    setRollbackError(null);
    try {
      const restored = await api.rollbackContentDraft(versionId);
      loadVersions(restored.id);
    } catch {
      setRollbackError("Couldn't roll back to that version.");
    } finally {
      setRollingBack(false);
    }
  }

  async function handleApprove() {
    if (!draft) return;
    setApproving(true);
    setApproveError(null);
    try {
      const updated = await api.approveContentDraft(draft.id);
      applyDraft(updated);
      loadVersions(updated.id);
    } catch {
      setApproveError("Couldn't approve this content draft.");
    } finally {
      setApproving(false);
    }
  }

  async function handleSavePage(pageId: string) {
    if (!draft) return;
    const state = edits[pageId];
    if (!state) return;
    setSavingPageId(pageId);
    setSaveError(null);
    try {
      const updated = await api.updateContentDraftPage(draft.id, pageId, toUpdatePayload(state));
      applyDraft(updated);
      loadVersions(updated.id);
    } catch {
      setSaveError("Couldn't save this page's content.");
    } finally {
      setSavingPageId(null);
    }
  }

  function updateField<K extends keyof PageEditState>(pageId: string, field: K, value: PageEditState[K]) {
    setEdits((prev) => ({ ...prev, [pageId]: { ...prev[pageId], [field]: value } }));
  }

  function updateServiceDescription(pageId: string, index: number, description: string) {
    setEdits((prev) => {
      const page = prev[pageId];
      const services = page.services.map((s, i) => (i === index ? { ...s, description } : s));
      return { ...prev, [pageId]: { ...page, services } };
    });
  }

  function updateFaqAnswer(pageId: string, index: number, answer: string) {
    setEdits((prev) => {
      const page = prev[pageId];
      const faqs = page.faqs.map((f, i) => (i === index ? { ...f, answer } : f));
      return { ...prev, [pageId]: { ...page, faqs } };
    });
  }

  if (loadError) return <div className="p-6 text-sm text-red-600">{loadError}</div>;
  if (versions === null) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-neutral-500 hover:underline">
        ← Back to project
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Website content</h1>
          <p className="text-xs text-neutral-500">
            AI-drafted headings, body copy, CTAs, service descriptions, FAQ answers, and SEO metadata — grounded in
            the approved brief and sitemap, never fabricated. Every field is editable before it feeds into the
            generated website.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600">Tone</span>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as ContentTone)}
            className="rounded-md border border-neutral-300 px-2 py-1.5"
          >
            {CONTENT_TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {generating ? "Drafting…" : draft ? "Regenerate content" : "Draft content"}
        </button>
      </div>
      {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}

      {versions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-500">Version:</span>
          <select
            value={draft?.id ?? ""}
            onChange={(e) => handleSelectVersion(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {new Date(v.generated_at).toLocaleString()} — {v.tone}
                {v.approved ? " — approved" : ""}
                {v.generated_by_user_name ? ` — ${v.generated_by_user_name}` : ""}
              </option>
            ))}
          </select>
          {draft && versions.length > 1 && (
            <button
              onClick={() => handleRollback(draft.id)}
              disabled={rollingBack}
              title="Create a new version with this version's content, so you can pick up an older draft again"
              className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              {rollingBack ? "Rolling back…" : "Roll back to this version"}
            </button>
          )}
        </div>
      )}
      {rollbackError && <p className="mt-2 text-sm text-red-600">{rollbackError}</p>}

      {!draft && (
        <p className="mt-6 text-sm text-neutral-500">
          No content drafted yet. This needs an approved sitemap with pages first.
        </p>
      )}

      {draft && (
        <div className="mt-6 rounded-md border border-neutral-200 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                draft.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {draft.status === "approved" ? `Approved by ${draft.approved_by_user_name}` : "Not approved"}
            </span>
            {draft.status !== "approved" && (
              <button
                onClick={handleApprove}
                disabled={approving}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                {approving ? "Approving…" : "Approve content"}
              </button>
            )}
            {draft.flagged_for_review && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Needs review
              </span>
            )}
          </div>
          {approveError && <p className="mt-2 text-sm text-red-600">{approveError}</p>}
          {draft.sources_note && <p className="mt-2 text-xs text-neutral-500">{draft.sources_note}</p>}
          {draft.missing_information.length > 0 && (
            <div className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">Content gaps (not invented — flagged instead):</p>
              <ul className="mt-1 list-disc pl-4">
                {draft.missing_information.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {saveError && <p className="mt-4 text-sm text-red-600">{saveError}</p>}

      {draft &&
        draft.pages.map((page) => {
          const state = edits[page.page_id];
          if (!state) return null;
          return (
            <div key={page.page_id} className="mt-6 rounded-md border border-neutral-200 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-900">{page.page_title}</h2>
                <button
                  onClick={() => handleSavePage(page.page_id)}
                  disabled={savingPageId === page.page_id}
                  className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                >
                  {savingPageId === page.page_id ? "Saving…" : "Save"}
                </button>
              </div>

              <div className="mt-3 grid gap-3">
                <label className="flex flex-col gap-1 text-xs text-neutral-600">
                  SEO title
                  <input
                    value={state.seo_title}
                    onChange={(e) => updateField(page.page_id, "seo_title", e.target.value)}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-neutral-600">
                  Meta description
                  <textarea
                    value={state.meta_description}
                    onChange={(e) => updateField(page.page_id, "meta_description", e.target.value)}
                    rows={2}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-neutral-600">
                  Hero heading
                  <input
                    value={state.hero_heading}
                    onChange={(e) => updateField(page.page_id, "hero_heading", e.target.value)}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-neutral-600">
                  Hero subheading
                  <textarea
                    value={state.hero_subheading}
                    onChange={(e) => updateField(page.page_id, "hero_subheading", e.target.value)}
                    rows={2}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
                {state.body && (
                  <label className="flex flex-col gap-1 text-xs text-neutral-600">
                    Body
                    <textarea
                      value={state.body}
                      onChange={(e) => updateField(page.page_id, "body", e.target.value)}
                      rows={3}
                      className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                )}

                {state.services.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-neutral-600">Service descriptions</p>
                    <div className="mt-1 grid gap-2">
                      {state.services.map((s, i) => (
                        <div key={s.title} className="rounded border border-neutral-200 p-2">
                          <p className="text-xs font-medium text-neutral-700">{s.title}</p>
                          <textarea
                            value={s.description}
                            onChange={(e) => updateServiceDescription(page.page_id, i, e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {state.faqs.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-neutral-600">FAQ answers</p>
                    <div className="mt-1 grid gap-2">
                      {state.faqs.map((f, i) => (
                        <div key={f.question} className="rounded border border-neutral-200 p-2">
                          <p className="text-xs font-medium text-neutral-700">{f.question}</p>
                          <textarea
                            value={f.answer}
                            onChange={(e) => updateFaqAnswer(page.page_id, i, e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <label className="flex flex-col gap-1 text-xs text-neutral-600">
                  CTA heading
                  <input
                    value={state.cta_heading}
                    onChange={(e) => updateField(page.page_id, "cta_heading", e.target.value)}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-neutral-600">
                  CTA body
                  <textarea
                    value={state.cta_body}
                    onChange={(e) => updateField(page.page_id, "cta_body", e.target.value)}
                    rows={2}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            </div>
          );
        })}
    </div>
  );
}
