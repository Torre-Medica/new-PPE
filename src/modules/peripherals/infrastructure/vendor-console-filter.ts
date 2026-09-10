let installed = false;
let originalConsoleLog: typeof console.log;

function shouldSuppressConsoleLog(args: unknown[]): boolean {
  if (args.length === 0) {
    return false;
  }

  const [firstArg] = args;

  if (firstArg instanceof Uint8Array) {
    return true;
  }

  if (Array.isArray(firstArg) && firstArg.every((item) => typeof item === 'number')) {
    return true;
  }

  if (typeof firstArg !== 'string') {
    return false;
  }

  const normalized = firstArg.trim();
  return [
    'Original:',
    'Limpieza:',
    'Conectando la tarjeta electrónica',
    'Conectando el validador de billetes',
    'Trama de éxito',
    'Trama de fallo',
  ].includes(normalized)
    || normalized.startsWith('Trama de ')
    || normalized.startsWith('Electronic board - Sending ')
    || normalized.startsWith('Bill validator - Sending ')
    || normalized.startsWith('Checksum: ');
}

export function installVendorConsoleFilter(): void {
  if (installed) {
    return;
  }

  installed = true;
  originalConsoleLog = console.log.bind(console);

  console.log = (...args: unknown[]) => {
    if (shouldSuppressConsoleLog(args)) {
      return;
    }

    originalConsoleLog(...args);
  };
}
