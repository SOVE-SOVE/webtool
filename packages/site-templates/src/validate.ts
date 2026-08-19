import type { SiteSection } from "@/types";
import { getSectionEntry } from "@/registry";

export type ValidationIssue = {
  field: string;
  message: string;
};

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Checks a section's config against its registry entry's requiredFields.
 * This only checks presence, not truthfulness — content authenticity
 * (no fabricated stats/testimonials/claims) is the Anti-Slop system's
 * job, layered on top of this. A section failing validation should be
 * flagged to the operator, never silently filled with placeholder text.
 */
export function validateSection(section: SiteSection): ValidationIssue[] {
  const entry = getSectionEntry(section.type);
  const issues: ValidationIssue[] = [];

  for (const field of entry.requiredFields) {
    const value = (section as unknown as Record<string, unknown>)[field];
    if (isEmpty(value)) {
      issues.push({ field, message: `"${field}" is required for a ${entry.label} section but is missing.` });
    }
  }

  return issues;
}

export function isSectionValid(section: SiteSection): boolean {
  return validateSection(section).length === 0;
}
