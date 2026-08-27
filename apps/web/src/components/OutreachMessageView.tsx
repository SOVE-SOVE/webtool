import type { OutreachMessage } from "@/lib/api";

function section(title: string, content: React.ReactNode) {
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h4>
      <div className="mt-1 text-sm text-fg">{content}</div>
    </div>
  );
}

function bulletList(items: string[]) {
  if (items.length === 0) return <p className="text-fg-subtle">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function OutreachMessageView({ message }: { message: OutreachMessage }) {
  return (
    <div>
      {message.flagged_for_review && (
        <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
          Flagged for review — evidence was limited when this draft was generated.
          {message.review_notes && <p className="mt-1">{message.review_notes}</p>}
        </div>
      )}
      {message.channel === "email" || message.channel === "follow_up" ? (
        <>
          {section("Subject", <p>{message.subject}</p>)}
          {section("Body", <p className="whitespace-pre-wrap">{message.body}</p>)}
        </>
      ) : (
        <>
          {section("Opening line", <p>{message.opening_line}</p>)}
          {section("Key points", bulletList(message.key_points))}
          {section("Objection handling", bulletList(message.objection_handling))}
          {section("Suggested close", <p>{message.suggested_close}</p>)}
        </>
      )}
    </div>
  );
}
