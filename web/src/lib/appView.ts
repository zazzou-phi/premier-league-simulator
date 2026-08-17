export type AppView = 'picks' | 'projections' | 'results';

/**
 * All three views exist in both modes. `results` used to be private-only because it was an
 * editor; it is now a read-only record, and the public audience is the one that most wants it.
 */
export const APP_VIEWS: AppView[] = ['picks', 'projections', 'results'];

export const APP_VIEW_LABELS: Record<AppView, string> = {
  picks: 'Picks',
  projections: 'Projections',
  results: 'Results',
};

/** Narrow-viewport tab text. Full labels do not fit at 375px beside the title and actions. */
export const APP_VIEW_SHORT_LABELS: Record<AppView, string> = {
  picks: 'Season',
  projections: 'Odds',
  results: 'Results',
};
