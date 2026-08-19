import type { Tone } from "@/types";

/** Background/text class pairs per tone. Centralized so every section
 * reads the same palette instead of each one picking its own grays. */
export const TONE_CLASSES: Record<Tone, { bg: string; text: string; muted: string; border: string }> = {
  light: { bg: "bg-white", text: "text-neutral-900", muted: "text-neutral-600", border: "border-neutral-200" },
  muted: { bg: "bg-neutral-50", text: "text-neutral-900", muted: "text-neutral-600", border: "border-neutral-200" },
  dark: { bg: "bg-neutral-900", text: "text-white", muted: "text-neutral-300", border: "border-neutral-700" },
  brand: { bg: "bg-neutral-900", text: "text-white", muted: "text-neutral-300", border: "border-neutral-700" },
};

export function toneClasses(tone: Tone = "light") {
  return TONE_CLASSES[tone];
}
