export type AppView = 'consensus' | 'projections' | 'results';

export const APP_VIEWS: AppView[] = ['consensus', 'projections', 'results'];

export function getAppViews(publicMode: boolean): AppView[] {
  return publicMode ? APP_VIEWS.filter((view) => view !== 'results') : APP_VIEWS;
}

export const APP_VIEW_LABELS: Record<AppView, string> = {
  consensus: 'Predictions',
  projections: 'Projections',
  results: 'Results',
};
