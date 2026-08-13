import { useEffect, useMemo, useState } from 'react';

// Simulates a brief loading state (skeletons) on mount / dependency change
export function useSimulatedLoading(deps: unknown[] = [], ms = 350) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const t = window.setTimeout(() => setLoading(false), ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return loading;
}

// Client-side pagination helper
export function usePaginated<T>(rows: T[], initialPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  // clamp page when data shrinks
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize]
  );

  return {
    page: safePage,
    pageSize,
    setPage,
    setPageSize: (s: number) => {
      setPageSize(s);
      setPage(1);
    },
    pageRows,
    total: rows.length,
  };
}
