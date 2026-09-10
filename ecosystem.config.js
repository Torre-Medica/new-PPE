const path = require('path');

/**
 * Backend y frontend como apps de PM2 separadas, en vez del supervisor casero
 * en scripts/start-monolith.js (que tenia un bug real: usaba shell:true, y la
 * señal de apagado no siempre llegaba al proceso nieto real — dejaba
 * huerfanos aferrados al puerto, y el frontend fallando tumbaba tambien al
 * backend sano). PM2 ya resuelve esto de forma probada: cada app se
 * supervisa, reinicia y loguea de forma independiente.
 *
 * Tanto el backend (ConfigModule de NestJS) como el frontend (loadEnv de
 * Vite) leen el .env directamente por su cuenta — no hace falta pasarles
 * variables de entorno aqui, solo el cwd correcto.
 *
 * Migracion (NO aplicar en produccion sin decision explicita):
 *   pm2 delete ppe
 *   pm2 start ecosystem.config.js
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'ppe-backend',
      script: 'out/src/main.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      // No arranca "npm run preview" directo — primero espera a que el
      // backend responda en su puerto (ver scripts/wait-for-backend-then-preview.js).
      // Evita que las primeras peticiones del frontend fallen con ECONNREFUSED
      // mientras el backend todavia esta conectando la placa/lector QR.
      name: 'ppe-frontend',
      script: 'scripts/wait-for-backend-then-preview.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
