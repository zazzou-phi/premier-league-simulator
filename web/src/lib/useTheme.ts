import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Kept in sync with the pre-paint script in index.html. */
const STORAGE_KEY = 'pl-sim:theme';

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function readStored(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    // Storage-disabled browsers throw on access; fall back to following the system.
    return 'system';
  }
}

/**
 * Theme preference, persisted to localStorage and applied as `data-theme` on the root.
 * `system` removes the attribute so the CSS media query decides (dark unless the OS asks
 * for light); an explicit choice sets the attribute, which the stylesheet lets win over the
 * media query in both directions. localStorage works in the public build, where the settings
 * API does not — so the toggle is available in both.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readStored);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);

    try {
      if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Persisting is best-effort; the applied attribute still holds for this session.
    }
  }, [preference]);

  return { preference, setPreference };
}
