/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_MODE?: 'private' | 'public';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
