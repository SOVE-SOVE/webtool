"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. Use for anything that can't be undone. */
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

/**
 * Promise-based replacement for window.confirm(): `await confirm({ title, description })`.
 * Mount once near the app root (dashboard layout) — every page under it can call useConfirm().
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending({ ...options, resolve });
    });
  }, []);

  function settle(value: boolean) {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="modal-overlay"
          onClick={() => settle(false)}
          role="presentation"
        >
          <div
            className="modal-panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-dialog-title" className="section-title">
              {pending.title}
            </h2>
            {pending.description && <p className="mt-2 text-sm text-fg-muted">{pending.description}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => settle(false)} autoFocus>
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className={`btn ${pending.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
