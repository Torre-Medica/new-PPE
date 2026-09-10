const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

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

// Libera un puerto que haya quedado ocupado por un proceso huerfano de un
// arranque anterior (ver nota mas abajo sobre por que esto puede pasar).
// No es fatal si no se puede — simplemente se intenta y se sigue adelante.
function freePortIfStale(port, label) {
  try {
    execSync(`fuser -k ${port}/tcp 2>/dev/null`, { stdio: 'ignore' });
    console.log(`[monolith] liberado puerto ${port} (${label}) de un proceso anterior`);
  } catch {
    // fuser devuelve codigo != 0 si no habia nada escuchando en el puerto — eso es lo normal.
  }
}

// spawn con processo propio (detached) para poder matar TODO su arbol de
// descendientes con una sola señal al grupo, en vez de solo al hijo directo.
// Antes se usaba `shell: true`, lo que crea `sh -c "npm run X"` como hijo
// real, y `npm` a su vez crea otro proceso (`vite`, `node out/src/main`,
// etc.) como NIETO. Cuando PM2 reinicia este script y se manda SIGTERM al
// hijo, la señal no siempre llega al nieto — problema conocido de Node con
// `shell:true` en arboles de procesos anidados. Eso dejaba procesos viejos
// vivos, aferrados a su puerto, y el siguiente arranque fallaba con
// "address already in use".
function startProcess(label, command, args, options) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    detached: true,
    ...options,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[${label}] finalizado por señal ${signal}`);
      return;
    }

    if (code && code !== 0) {
      console.error(`[${label}] finalizó con código ${code}`);
      process.exitCode = code;
    }
  });

  return child;
}

function killProcessTree(child, signal) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  try {
    // PID negativo = matar todo el grupo de procesos (child + sus propios hijos),
    // posible porque se lanzo con `detached: true`.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // el proceso ya pudo haber muerto entre el chequeo y el kill — se ignora.
    }
  }
}

const mode = process.argv[2] === 'prod' ? 'prod' : 'dev';
const rootDir = path.resolve(__dirname, '..');
const envFile = path.join(rootDir, '.env');
const fileEnv = parseEnvFile(envFile);

const mergedEnv = {
  ...process.env,
  ...fileEnv,
};

mergedEnv.PORT = mergedEnv.PORT || '3000';
mergedEnv.FRONTEND_PORT = mergedEnv.FRONTEND_PORT || '5173';

console.log(
  `[monolith] levantando PPE ${mode} backend en puerto ${mergedEnv.PORT} y frontend en puerto ${mergedEnv.FRONTEND_PORT}`,
);

// Seguro preventivo: si un arranque anterior dejo procesos huerfanos aferrados
// a estos puertos, liberarlos antes de intentar levantar de nuevo.
freePortIfStale(mergedEnv.PORT, 'backend');
freePortIfStale(mergedEnv.FRONTEND_PORT, 'frontend');

const backendScript = mode === 'prod' ? 'start:backend:prod' : 'start:backend';
const frontendScript = mode === 'prod' ? 'start:frontend:prod' : 'start:frontend';

const backend = startProcess('backend', 'npm', ['run', backendScript], {
  cwd: rootDir,
  env: mergedEnv,
});

let currentFrontend = startProcess('frontend', 'npm', ['run', frontendScript], {
  cwd: rootDir,
  env: mergedEnv,
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[monolith] cerrando procesos por ${signal}`);

  killProcessTree(backend, signal);
  killProcessTree(currentFrontend, signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// El backend es el servicio critico (pagos, hardware). Si el backend muere,
// no tiene sentido dejar el frontend sirviendo una UI sin nada detras —
// se apaga todo.
backend.on('exit', () => shutdown('SIGTERM'));

// El frontend NO debe tumbar el backend si falla — un problema de puerto o
// de la UI no tiene por que interrumpir un pago que ya esta en curso en el
// backend. Se reporta el fallo y se reintenta el frontend solo, sin tocar
// el backend.
let frontendRestartAttempts = 0;
const MAX_FRONTEND_RESTART_ATTEMPTS = 5;

function handleFrontendExit(code, signal) {
  if (shuttingDown || signal) {
    return;
  }

  frontendRestartAttempts += 1;
  if (frontendRestartAttempts > MAX_FRONTEND_RESTART_ATTEMPTS) {
    console.error(
      `[monolith] el frontend fallo ${frontendRestartAttempts} veces seguidas — ` +
      `se deja de reintentar, pero el backend sigue corriendo`,
    );
    return;
  }

  console.error(
    `[monolith] el frontend termino con codigo ${code} — reintentando en 3s ` +
    `(intento ${frontendRestartAttempts}/${MAX_FRONTEND_RESTART_ATTEMPTS}), backend no se toca`,
  );

  setTimeout(() => {
    if (shuttingDown) {
      return;
    }
    freePortIfStale(mergedEnv.FRONTEND_PORT, 'frontend');
    currentFrontend = startProcess('frontend', 'npm', ['run', frontendScript], {
      cwd: rootDir,
      env: mergedEnv,
    });
    currentFrontend.on('exit', handleFrontendExit);
  }, 3000);
}

currentFrontend.on('exit', handleFrontendExit);
