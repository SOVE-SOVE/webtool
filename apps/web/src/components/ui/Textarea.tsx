import { forwardRef, type ComponentPropsWithoutRef } from "react";

/**
 * The shared entry point for every multi-line field in the app — see
 * Input.tsx for why this stays a thin pass-through rather than imposing
 * its own styling.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(function Textarea(
  props,
  ref,
) {
  return <textarea ref={ref} {...props} />;
});
