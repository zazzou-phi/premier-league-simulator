export type AppMode = 'private' | 'public';

export function getAppMode(): AppMode {
  const mode = import.meta.env.VITE_APP_MODE;
  return mode === 'public' ? 'public' : 'private';
}

export function isPublicMode(): boolean {
  return getAppMode() === 'public';
}
