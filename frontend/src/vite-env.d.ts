/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIMULATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
