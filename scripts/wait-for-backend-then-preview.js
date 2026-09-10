// Arranca el frontend (vite preview) solo despues de confirmar que el backend
// ya esta aceptando conexiones. Sin esto, PM2 lanza ambos procesos en
// paralelo: si el frontend arranca primero, sus primeras peticiones a /api
// fallan con ECONNREFUSED mientras el backend termina de inicializar
// (conectar placa, lector QR, etc. puede tardar unos segundos).
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    const commentIndex = value.indexOf(' #');
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex).trim();
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function waitForPort(port, host, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });

      socket.on('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`timeout esperando ${host}:${port} tras ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    }

    attempt();
  });
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const envFile = path.join(rootDir, '.env');
  const fileEnv = parseEnvFile(envFile);
  const backendPort = Number(process.env.PORT || fileEnv.PORT || 3100);
  const timeoutMs = Number(process.env.WAIT_FOR_BACKEND_TIMEOUT_MS || 60000);

  console.log(`[wait-for-backend] esperando a que el backend responda en 127.0.0.1:${backendPort}...`);

  try {
    await waitForPort(backendPort, '127.0.0.1', timeoutMs, 500);
    console.log('[wait-for-backend] backend listo — arrancando frontend (vite preview)');
  } catch (error) {
    console.error(
      `[wait-for-backend] ${error.message} — arrancando el frontend de todas formas ` +
      `(el proxy de vite reintentara las llamadas a /api por su cuenta)`,
    );
  }

  const frontendDir = path.join(rootDir, 'frontend');
  const child = spawn('npm', ['run', 'preview'], {
    stdio: 'inherit',
    detached: true,
    cwd: frontendDir,
    env: process.env,
  });

  function forwardSignal(signal) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // el proceso ya pudo haber terminado — se ignora.
      }
    }
  }

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(0);
    }
    process.exit(code ?? 0);
  });
}

main();
