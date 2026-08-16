"use client";

import { useEffect } from "react";

// Catches errors thrown by the root layout itself, where app/error.tsx
// can't help because it renders inside that same layout.
export default function GlobalError({
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
    <html lang="en">
      <body>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <h1>Something went wrong</h1>
            <button onClick={reset}>Try again</button>
          </div>
        </main>
      </body>
    </html>
  );
}
