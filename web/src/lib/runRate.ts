const STORAGE_KEY = 'pl-sim:ms-per-run';

/**
 * Milliseconds per simulated season, remembered from the last completed batch so the next
 * one can be costed before it is started. Deliberately a single number rather than a
 * history: run cost tracks the machine, and the most recent measurement is the best
 * estimate of the next one.
 *
 * Absent or unparseable storage yields null, and callers show nothing — a made-up estimate
 * is worse than no estimate.
 */
export function readRunRate(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    // Private-mode Safari and storage-disabled browsers throw on access, not on read.
    return null;
  }
}

export function writeRunRate(elapsedMs: number, runs: number): void {
  if (runs <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(elapsedMs / runs));
  } catch {
    // Estimates are a convenience; failing to persist one is not worth surfacing.
  }
}
