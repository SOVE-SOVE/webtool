"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PreviewApiError, previewApi, type PublicPreview } from "@/lib/previewApi";
import { PreviewSiteRenderer } from "@/components/PreviewSiteRenderer";

// Fixed max-widths, not a live resize — this is a proxy for "how does
// this look on a phone/tablet", not a real device emulator.
const DEVICE_WIDTHS = { desktop: "w-full", tablet: "max-w-[768px]", mobile: "max-w-[390px]" } as const;
type Device = keyof typeof DEVICE_WIDTHS;

export default function PublicPreviewPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [preview, setPreview] = useState<PublicPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [activePageSlug, setActivePageSlug] = useState<string | null>(null);

  function load(websiteId?: string) {
    previewApi
      .get(token, websiteId)
      .then((p) => {
        setPreview(p);
        setActivePageSlug(p.pages[0]?.slug ?? null);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof PreviewApiError && err.status === 410) setError(err.message);
        else if (err instanceof PreviewApiError && err.status === 404) {
          setError("This preview isn't available — the link may be wrong, revoked, or nothing has been shared yet.");
        } else setError("Couldn't load this preview.");
      });
  }

  useEffect(() => load(), [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
        <p className="max-w-sm text-center text-sm text-neutral-600">{error}</p>
      </div>
    );
  }
  if (!preview) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">Loading preview…</div>;
  }

  const activePage = preview.pages.find((p) => p.slug === activePageSlug) ?? preview.pages[0];

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-neutral-900">{preview.project_name}</p>
          <p className="text-xs text-neutral-500">{preview.audience === "internal" ? "Internal preview" : "Client preview"}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {preview.pages.length > 1 && (
            <select
              value={activePage?.slug ?? ""}
              onChange={(e) => setActivePageSlug(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
            >
              {preview.pages.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          {preview.versions.length > 1 && (
            <select
              value={preview.website_id}
              onChange={(e) => load(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
            >
              {preview.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          )}

          <div className="flex rounded-md border border-neutral-300 p-0.5 text-xs">
            {(Object.keys(DEVICE_WIDTHS) as Device[]).map((d) => (
              <button
                key={d}
                onClick={() => setDevice(d)}
                className={`rounded px-2.5 py-1 capitalize ${device === d ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex justify-center px-4 py-6">
        <div className={`mx-auto w-full ${DEVICE_WIDTHS[device]} overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm transition-[max-width]`}>
          {activePage ? (
            <PreviewSiteRenderer navigation={preview.navigation} sections={activePage.sections} footer={preview.footer} />
          ) : (
            <p className="p-8 text-center text-sm text-neutral-500">This version has no pages yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
