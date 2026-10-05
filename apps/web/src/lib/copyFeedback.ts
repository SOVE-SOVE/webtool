/**
 * Pure rules behind `components/ui/CopyButton.tsx`, DOM-free so they are
 * unit-tested.
 */
export type CopyStatus = "idle" | "copied" | "failed";

/** How long the "Copied" / "Couldn't copy" state stays before reverting. */
export const COPY_FEEDBACK_MS = 1800;

type ClipboardLike = { writeText: (text: string) => Promise<void> };

/**
 * Writes `text` to the clipboard and resolves to whether it really got
 * there. Deliberately not `async`: `writeText` is called synchronously,
 * inside the caller's click handler, because Safari only allows a
 * clipboard write during the user gesture itself. A missing Clipboard
 * API (insecure context, old browser), a synchronous throw and a
 * rejected promise (permission denied) all resolve `false` — never a
 * false success.
 */
export function writeClipboard(
  text: string,
  clipboard: ClipboardLike | undefined | null = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== "function") return Promise.resolve(false);
  try {
    return clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** The state a finished write puts the button in — or null when a newer
 * click (or an unmount) has superseded that write, so it changes nothing. */
export function copyOutcome(ok: boolean, attempt: number, latestAttempt: number): CopyStatus | null {
  if (attempt !== latestAttempt) return null;
  return ok ? "copied" : "failed";
}

/** What a screen reader hears (once, politely) for each state. */
export function copyAnnouncement(status: CopyStatus): string {
  return status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy" : "";
}
