import { forwardRef, type ComponentPropsWithoutRef } from "react";

/**
 * The shared entry point for every text/number/date/etc. field in the
 * app, so call sites share one component instead of each hand-writing
 * <input>. A thin pass-through — renders the same underlying element
 * with the same props, so an existing `className` (the `.input`
 * component class from globals.css, or none at all — the `@layer base`
 * rule there themes a bare, unclassed <input> too) keeps producing the
 * exact same markup and styling it always did.
 */
export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input">>(function Input(props, ref) {
  return <input ref={ref} {...props} />;
});
