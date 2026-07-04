"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  canAddToCompare,
  COMPARE_MAX,
  parseCompareIds,
  serializeCompareIds,
  toggleCompareId,
} from "../../lib/compare";

/**
 * Holds the PG compare-set (2–4 listing ids) for the session. Compare is a mode
 * the user opts INTO — the tray only appears once something is added, never on by
 * default. The set persists in sessionStorage so it survives navigation within
 * the tab, and the compare PAGE mirrors it into a shareable URL. This context
 * stores only ids; the table fetches the full listings from those ids.
 */
interface CompareContextValue {
  ids: string[];
  count: number;
  has: (id: string) => boolean;
  canAdd: boolean;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Adopt an explicit set (e.g. from a shared /compare?ids=… link). */
  setIds: (ids: string[]) => void;
}

const CompareContext = createContext<CompareContextValue | null>(null);
const STORAGE_KEY = "ra_compare";

export function useCompare(): CompareContextValue {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used within <CompareProvider>");
  return ctx;
}

export function CompareProvider({ children }: { children: ReactNode }): ReactNode {
  const [ids, setIdsState] = useState<string[]>([]);

  // Hydrate from sessionStorage on mount (client-only; SSR renders an empty set).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setIdsState(parseCompareIds(raw));
    } catch {
      // sessionStorage may be unavailable (private mode) — the tray just stays empty.
    }
  }, []);

  const persist = useCallback((next: string[]) => {
    setIdsState(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, serializeCompareIds(next));
    } catch {
      // Non-fatal: state still lives in memory for this view.
    }
  }, []);

  const has = useCallback((id: string) => ids.includes(id), [ids]);
  const toggle = useCallback((id: string) => persist(toggleCompareId(ids, id)), [ids, persist]);
  const remove = useCallback((id: string) => persist(ids.filter((x) => x !== id)), [ids, persist]);
  const clear = useCallback(() => persist([]), [persist]);
  const setIds = useCallback((next: string[]) => persist(parseCompareIds(serializeCompareIds(next))), [persist]);

  const value = useMemo<CompareContextValue>(
    () => ({ ids, count: ids.length, has, canAdd: canAddToCompare(ids), toggle, remove, clear, setIds }),
    [ids, has, toggle, remove, clear, setIds],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export { COMPARE_MAX };
