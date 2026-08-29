"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-subtle p-8">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
        <p className="text-sm text-fg-muted">
          The page hit an unexpected error. You can try again, or come back later.
        </p>
        <button
          onClick={reset}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
