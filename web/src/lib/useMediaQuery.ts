import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const MOBILE_QUERY = '(max-width: 640px)';

/**
 * The width below which the projections table hides its distribution column (`app.css`).
 * ProjectionsView switches to the card list here, not at MOBILE_QUERY, so the distribution
 * never vanishes into the 641–900px gap between the two.
 */
export const PROJECTIONS_CARDS_QUERY = '(max-width: 900px)';
