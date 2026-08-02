import type { TeamEloSnapshot } from '../types.js';

export interface TeamEloSeries {
  /** Snapshot values oldest → newest. */
  values: number[];
  dates: string[];
  /** Change from the previous snapshot to the latest; null with fewer than two. */
  delta: number | null;
}

/**
 * Group dated snapshots by team. `teams.elo` is overwritten by every ratings sync, so the
 * series is the only way to show how a rating moved rather than just where it landed.
 */
export function groupEloSeries(history: TeamEloSnapshot[]): Map<number, TeamEloSeries> {
  const byTeam = new Map<number, TeamEloSnapshot[]>();
  for (const snapshot of history) {
    const list = byTeam.get(snapshot.teamId);
    if (list) list.push(snapshot);
    else byTeam.set(snapshot.teamId, [snapshot]);
  }

  const series = new Map<number, TeamEloSeries>();
  for (const [teamId, snapshots] of byTeam) {
    const ordered = [...snapshots].sort((a, b) => a.asOf.localeCompare(b.asOf));
    const values = ordered.map((snapshot) => snapshot.elo);
    series.set(teamId, {
      values,
      dates: ordered.map((snapshot) => snapshot.asOf),
      delta: values.length >= 2 ? values.at(-1)! - values.at(-2)! : null,
    });
  }
  return series;
}

/** Sub-point moves are clubelo float precision, not real movement. */
export const ELO_MOVE_THRESHOLD = 0.5;

export function formatEloDelta(delta: number | null): string {
  if (delta == null || Math.abs(delta) < ELO_MOVE_THRESHOLD) return '—';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(0)}`;
}
