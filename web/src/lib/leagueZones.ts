import type { LeagueZone } from '@shared/engine/standings.js';

export const ZONE_LABELS: Record<LeagueZone, string> = {
  champion: 'Champion',
  championsLeague: 'Champions League',
  europaLeague: 'Europa League',
  midtable: 'Mid-table',
  relegation: 'Relegation',
};

export const LEGEND_ZONES: LeagueZone[] = [
  'champion',
  'championsLeague',
  'europaLeague',
  'relegation',
];
