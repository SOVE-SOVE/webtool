import { useState } from "react";
import { api, type Brief, type BriefFieldValue, type BriefUpdate } from "@/lib/api";

type FieldKind = "text" | "textarea" | "list";

type FieldDef = { key: keyof BriefUpdate; label: string; kind: FieldKind };

const SECTIONS: { key: keyof Pick<Brief, "business" | "brand" | "content" | "website" | "assets">; fields: FieldDef[] }[] = [
  {
    key: "business",
    fields: [
      { key: "business_name", label: "Business name", kind: "text" },
      { key: "industry", label: "Industry", kind: "text" },
      { key: "location", label: "Location", kind: "text" },
      { key: "contact_name", label: "Contact name", kind: "text" },
      { key: "contact_email", label: "Contact email", kind: "text" },
      { key: "contact_phone", label: "Contact phone", kind: "text" },
      { key: "business_description", label: "Business description", kind: "textarea" },
      { key: "services_products", label: "Services / products", kind: "textarea" },
      { key: "target_customers", label: "Target customers", kind: "textarea" },
      { key: "business_goals", label: "Main business goals", kind: "textarea" },
    ],
  },
  {
    key: "brand",
    fields: [
      { key: "brand_name", label: "Brand name", kind: "text" },
      { key: "logo_notes", label: "Logo", kind: "textarea" },
      { key: "brand_colours", label: "Colours", kind: "list" },
      { key: "brand_fonts", label: "Fonts", kind: "list" },
      { key: "brand_guidelines", label: "Brand guidelines", kind: "textarea" },
      { key: "visual_references", label: "Visual references", kind: "list" },
      { key: "existing_social_profiles", label: "Existing social profiles", kind: "list" },
    ],
  },
  {
    key: "content",
    fields: [
      { key: "about_content", label: "About / business information", kind: "textarea" },
      { key: "services_content", label: "Services", kind: "textarea" },
      { key: "products_content", label: "Products", kind: "textarea" },
      { key: "content_contact_details", label: "Contact details", kind: "textarea" },
      { key: "testimonials", label: "Testimonials", kind: "list" },
      { key: "faqs", label: "FAQs", kind: "list" },
      { key: "calls_to_action", label: "Calls to action", kind: "list" },
    ],
  },
  {
    key: "website",
    fields: [
      { key: "required_pages", label: "Required pages", kind: "list" },
      { key: "required_functionality", label: "Required functionality", kind: "list" },
      { key: "existing_website_url", label: "Existing website", kind: "text" },
      { key: "domain", label: "Domain", kind: "text" },
      { key: "hosting", label: "Hosting", kind: "textarea" },
      { key: "integrations", label: "Integrations", kind: "list" },
    ],
  },
  {
    key: "assets",
    fields: [
      { key: "logo_assets", label: "Logos", kind: "list" },
      { key: "image_assets", label: "Images", kind: "list" },
      { key: "video_assets", label: "Videos", kind: "list" },
      { key: "document_assets", label: "Documents", kind: "list" },
      { key: "existing_copy_assets", label: "Existing copy", kind: "list" },
    ],
  },
];

const SECTION_LABELS: Record<(typeof SECTIONS)[number]["key"], string> = {
  business: "Business",
  brand: "Brand",
  content: "Content",
  website: "Website",
  assets: "Assets",
};

function toText(value: BriefFieldValue): string {
  if (value == null) return "";
  return Array.isArray(value) ? value.join("\n") : value;
}

const inputClass = "w-full rounded-md border border-border-strong px-3 py-1.5 text-sm";

export function BriefEditor({ brief, onChange }: { brief: Brief; onChange: (brief: Brief) => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  async function save(field: keyof BriefUpdate, value: string) {
    setSaving(field);
    setError(null);
    try {
      const updated = await api.updateBrief(brief.project_id, { [field]: value } as BriefUpdate);
      onChange(updated);
    } catch {
      setError("Couldn't save that field — try again.");
    } finally {
      setSaving(null);
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const updated = await api.approveBrief(brief.project_id);
      onChange(updated);
    } catch {
      setError("Couldn't approve the brief — try again.");
    } finally {
      setApproving(false);
    }
  }

  const missingCount = brief.missing_fields.length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-4 py-3">
        <div>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              brief.status === "approved"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-surface-hover text-fg-muted"
            }`}
          >
            {brief.status === "approved" ? "Approved" : "Draft"}
          </span>
          {brief.status === "approved" && brief.approved_at && (
            <span className="ml-2 text-xs text-fg-muted">
              Approved {new Date(brief.approved_at).toLocaleString()}
              {brief.approved_by_user_name && ` by ${brief.approved_by_user_name}`}
            </span>
          )}
          {missingCount > 0 ? (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              {missingCount} field{missingCount === 1 ? "" : "s"} still missing — nothing has been
              filled in for you.
            </p>
          ) : (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">Every field has been collected.</p>
          )}
        </div>
        <button
          onClick={approve}
          disabled={approving || brief.status === "approved"}
          className="btn btn-primary"
        >
          {brief.status === "approved" ? "Approved — ready for design" : approving ? "Approving…" : "Approve brief"}
        </button>
      </div>

      {error && <p className="mt-3 text-error">{error}</p>}

      {SECTIONS.map((section) => {
        const data = brief[section.key];
        return (
          <section key={section.key} className="mt-6">
            <h3 className="text-sm font-semibold text-fg">{SECTION_LABELS[section.key]}</h3>
            <div className="mt-3 grid grid-cols-2 gap-4">
              {section.fields.map((f) => {
                const value = data.fields[f.key as string];
                const isMissing = data.missing.includes(f.label);
                const wide = f.kind !== "text";
                return (
                  <div key={f.key as string} className={wide ? "col-span-2" : undefined}>
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-muted">
                      <span>{f.label}</span>
                      {isMissing && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          Missing
                        </span>
                      )}
                      {saving === f.key && <span className="normal-case tracking-normal">Saving…</span>}
                    </div>
                    {f.kind === "text" ? (
                      <input
                        defaultValue={toText(value)}
                        onBlur={(e) => save(f.key, e.target.value)}
                        className={`mt-1 ${inputClass}`}
                      />
                    ) : (
                      <textarea
                        defaultValue={toText(value)}
                        onBlur={(e) => save(f.key, e.target.value)}
                        placeholder={f.kind === "list" ? "One per line" : undefined}
                        rows={3}
                        className={`mt-1 ${inputClass}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
