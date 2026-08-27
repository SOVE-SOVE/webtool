"use client";

import { useState, type FormEvent } from "react";
import { FEEDBACK_TYPES, previewApi, type FeedbackType } from "@/lib/previewApi";

const TYPE_LABELS: Record<FeedbackType, string> = {
  comment: "Comment",
  change_request: "Request a change",
  approval: "Approve this version",
  rejection: "Reject this version",
  general: "General feedback",
};

export function PreviewFeedbackForm({
  token,
  websiteId,
  pageSlug,
}: {
  token: string;
  websiteId: string;
  pageSlug: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("comment");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await previewApi.submitFeedback(token, websiteId, {
        feedback_type: feedbackType,
        message: message.trim(),
        page_slug: pageSlug,
        client_name: name.trim() || undefined,
        client_email: email.trim() || undefined,
      });
      setSent(true);
      setMessage("");
    } catch {
      setError("Couldn't send your feedback — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setSent(false);
        }}
        className="fixed bottom-6 right-6 z-20 rounded-full bg-accent px-5 py-3 text-sm font-medium text-accent-fg shadow-lg hover:opacity-90"
      >
        Leave feedback
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-end bg-black/20 p-4 sm:items-center sm:justify-center">
      <div className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Leave feedback</h2>
          <button onClick={() => setOpen(false)} aria-label="Close" className="text-fg-subtle hover:text-fg-muted">
            ✕
          </button>
        </div>

        {sent ? (
          <div className="mt-4">
            <p className="text-sm text-fg-muted">Thanks — your feedback has been sent.</p>
            <button
              onClick={() => setOpen(false)}
              className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-accent-fg hover:opacity-90"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-fg-muted">Type</label>
              <select
                value={feedbackType}
                onChange={(e) => setFeedbackType(e.target.value as FeedbackType)}
                className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
              >
                {FEEDBACK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-fg-muted">Message</label>
              <textarea
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
                placeholder={pageSlug !== null ? "What would you like to say about this page?" : "Your feedback"}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-fg-muted">Your name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-fg-muted">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            {error && <p className="text-error">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
