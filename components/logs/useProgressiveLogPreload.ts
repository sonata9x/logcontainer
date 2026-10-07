"use client";

import { useEffect } from "react";

const BACKGROUND_BATCH_DELAY_MS = 1_200;

/**
 * Keeps the first paint small, then fills the remaining timeline one batch at
 * a time while the browser is idle. Existing scroll/sentinel loading can still
 * call the same guarded loader immediately.
 */
export function useProgressiveLogPreload(hasMore: boolean, loading: boolean, loadMore: () => void | Promise<void>) {
  useEffect(() => {
    if (!hasMore || loading) return;
    let idleId: number | null = null;
    const timer = window.setTimeout(() => {
      const run = () => { void loadMore(); };
      if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(run, { timeout: BACKGROUND_BATCH_DELAY_MS });
      else run();
    }, BACKGROUND_BATCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (idleId !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleId);
    };
  }, [hasMore, loadMore, loading]);
}
