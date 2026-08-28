export type AppView = 'season' | 'projections';

/**
 * Two views: the season itself — results, picks and the table they produce — and the
 * aggregate odds behind it. Picks and results used to be separate tabs showing the same
 * fixture list twice; they are one view now, split by a matchday cutoff rather than a tab.
 */
export const APP_VIEWS: AppView[] = ['season', 'projections'];

/** The view the app opens on: what has happened, and what the model says happens next. */
export const DEFAULT_APP_VIEW: AppView = 'season';

export const APP_VIEW_LABELS: Record<AppView, string> = {
  season: 'Season',
  projections: 'Projections',
};
