/**
 * The decisions behind a drawer's exit transition, kept free of the DOM
 * so they can be tested — see useOverlayExit.ts for what acts on them.
 */

export type OverlayExitContext = {
  /** The user asked for reduced motion: close instantly, as before. */
  reducedMotion: boolean;
  /** The tab isn't visible, so there is nothing to show. */
  documentHidden: boolean;
  /** The overlay is still in the document after its cleanup ran — it
   * didn't really close (React's development-only effect re-run). */
  stillConnected: boolean;
  /** Another drawer mounted in the same update — one drawer replacing
   * another (a different record, or payment details over the records
   * list). The new one arrives on its own; the old one just goes. */
  replaced: boolean;
};

export function shouldPlayOverlayExit(ctx: OverlayExitContext): boolean {
  return !ctx.reducedMotion && !ctx.documentHidden && !ctx.stillConnected && !ctx.replaced;
}

export type ExitStartStyle = { opacity: string | null; transform: string | null };

/**
 * Where a closing surface starts its exit from: the opacity/transform it
 * actually showed when it closed, so one closed part-way through its
 * entrance doesn't jump to fully open first. `null` means "at rest" —
 * nothing to carry over. Takes the computed values (empty when the
 * element had already left the document).
 */
export function exitStartStyle(computed: { opacity: string; transform: string } | null): ExitStartStyle {
  if (!computed) return { opacity: null, transform: null };
  const opacity = Number.parseFloat(computed.opacity);
  const transform = computed.transform.trim();
  return {
    opacity: Number.isFinite(opacity) && opacity >= 0 && opacity < 1 ? String(opacity) : null,
    transform: transform === "" || transform === "none" ? null : transform,
  };
}
