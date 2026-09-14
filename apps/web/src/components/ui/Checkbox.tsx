import { forwardRef, type ComponentPropsWithoutRef } from "react";

/**
 * The shared entry point for every checkbox in the app. Fixes
 * `type="checkbox"` so call sites don't repeat it; everything else
 * (checked, onChange, className, aria-label, …) passes straight
 * through. Checkboxes keep their native rendering app-wide (see the
 * `:not([type="checkbox"])` carve-out in globals.css's `@layer base`),
 * so this stays a thin wrapper rather than imposing new styling.
 */
export const Checkbox = forwardRef<HTMLInputElement, Omit<ComponentPropsWithoutRef<"input">, "type">>(
  function Checkbox(props, ref) {
    return <input ref={ref} type="checkbox" {...props} />;
  },
);
