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
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Something went wrong</h1>
        <p className="text-sm text-neutral-500">
          The page hit an unexpected error. You can try again, or come back later.
        </p>
        <button
          onClick={reset}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
