import { forwardRef, type ComponentPropsWithoutRef } from "react";

/**
 * The shared entry point for every dropdown in the app — see Input.tsx
 * for why this stays a thin pass-through rather than imposing its own
 * styling: a `<select>` rendered through this component matches
 * whatever the call site's own `className` (or the `@layer base` /
 * `select.input` rules in globals.css) already produced.
 */
export const Select = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<"select">>(function Select(
  props,
  ref,
) {
  return <select ref={ref} {...props} />;
});
