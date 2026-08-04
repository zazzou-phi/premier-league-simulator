export type AppView = 'consensus' | 'projections' | 'results';

export const APP_VIEWS: AppView[] = ['consensus', 'projections', 'results'];

export function getAppViews(publicMode: boolean): AppView[] {
  return publicMode ? APP_VIEWS.filter((view) => view !== 'results') : APP_VIEWS;
}

export const APP_VIEW_LABELS: Record<AppView, string> = {
  consensus: 'Consensus',
  projections: 'Projections',
  results: 'Results',
};

/** Narrow-viewport tab text. Full labels do not fit at 375px beside the title and actions. */
export const APP_VIEW_SHORT_LABELS: Record<AppView, string> = {
  consensus: 'Season',
  projections: 'Odds',
  results: 'Results',
};
