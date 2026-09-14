"use client";

import { useEffect } from "react";

/**
 * Closes a modal/dialog/drawer on Escape — the one keyboard behavior
 * every overlay in the app should have, but each modal (NewTaskModal,
 * TaskDetailModal, InstagramImportModal, ConfirmProvider, Settings' add-
 * teammate dialog, ...) previously left out since there's no shared
 * `<Modal>` wrapper component to put it on centrally.
 */
export function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}
