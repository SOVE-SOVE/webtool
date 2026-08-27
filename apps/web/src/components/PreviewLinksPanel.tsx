"use client";

import { useEffect, useState } from "react";
import { api, type PreviewAudience, type PreviewLink } from "@/lib/api";

export function PreviewLinksPanel({ projectId }: { projectId: string }) {
  const [links, setLinks] = useState<PreviewLink[] | null>(null);
  const [audience, setAudience] = useState<PreviewAudience>("client");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    api.listPreviewLinks(projectId).then(setLinks).catch(() => {});
  }

  useEffect(load, [projectId]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setJustCreatedUrl(null);
    try {
      const created = await api.createPreviewLink(projectId, { audience });
      setJustCreatedUrl(created.url);
      load();
    } catch {
      setError("Couldn't create a preview link.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied — the link is still shown on
      // screen, so there's a manual fallback either way.
    }
  }

  async function handleRevoke(id: string) {
    try {
      await api.revokePreviewLink(id);
      load();
    } catch {
      setError("Couldn't revoke that link.");
    }
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Client & internal previews</h2>
        <div className="flex items-center gap-2">
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as PreviewAudience)}
            className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
          >
            <option value="client">Client link</option>
            <option value="internal">Internal link</option>
          </select>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle disabled:opacity-50"
          >
            {creating ? "Creating…" : "New link"}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-error">{error}</p>}

      {justCreatedUrl && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <code className="flex-1 truncate text-emerald-900">{justCreatedUrl}</code>
          <button
            onClick={() => handleCopy(justCreatedUrl)}
            className="shrink-0 rounded-md border border-emerald-300 bg-surface px-2 py-1 text-xs hover:bg-emerald-50"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {justCreatedUrl && (
        <p className="mt-1 text-xs text-fg-muted">
          This link is only shown once — copy it now. Revoke it below if it&apos;s shared by mistake.
        </p>
      )}

      <div className="mt-4 divide-y divide-border text-sm">
        {links === null && <p className="text-fg-muted">Loading…</p>}
        {links !== null && links.length === 0 && <p className="text-fg-muted">No preview links yet.</p>}
        {links?.map((link) => (
          <div key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <span className="font-medium text-fg">
                {link.audience === "internal" ? "Internal" : "Client"}
              </span>
              <span className="ml-2 text-fg-subtle">…{link.token_suffix}</span>
              {link.label && <span className="ml-2 text-fg-muted">— {link.label}</span>}
              <div className="text-xs text-fg-muted">
                {link.access_count} view{link.access_count === 1 ? "" : "s"}
                {link.last_accessed_at ? ` · last opened ${new Date(link.last_accessed_at).toLocaleString()}` : ""}
                {link.expires_at ? ` · expires ${new Date(link.expires_at).toLocaleDateString()}` : " · never expires"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  link.active ? "bg-emerald-100 text-emerald-800" : "bg-surface-subtle text-fg-muted"
                }`}
              >
                {link.revoked ? "Revoked" : link.expired ? "Expired" : "Active"}
              </span>
              {link.active && (
                <button
                  onClick={() => handleRevoke(link.id)}
                  className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-subtle"
                >
                  Revoke
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
