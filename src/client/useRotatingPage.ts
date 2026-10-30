import { useEffect, useState } from 'react';

/** Pages through a long list on the TV every 8 seconds. */
export function useRotatingPage(count: number, size: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(count / size));
  useEffect(() => {
    const timer = setInterval(() => setPage((p) => (p + 1) % pages), 8000);
    return () => clearInterval(timer);
  }, [pages]);
  return page % pages;
}
