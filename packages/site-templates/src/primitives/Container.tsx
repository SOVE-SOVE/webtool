import type { ReactNode } from "react";

const MAX_WIDTH = {
  default: "max-w-6xl",
  narrow: "max-w-3xl",
} as const;

export function Container({
  children,
  className = "",
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: keyof typeof MAX_WIDTH;
}) {
  return <div className={`mx-auto w-full ${MAX_WIDTH[width]} px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
