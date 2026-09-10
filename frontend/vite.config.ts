import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const rootEnvDir = path.resolve(__dirname, '..');
  const env = loadEnv(mode, rootEnvDir, '');
  const frontendPort = Number(env.FRONTEND_PORT || 5173);
  const backendPort = Number(env.PORT || 3100);

  return {
    envDir: rootEnvDir,
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
