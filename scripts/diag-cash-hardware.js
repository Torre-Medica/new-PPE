'use strict';

/**
 * Diagnostico de hardware de efectivo PPE
 *
 * Objetivo:
 * - Conectar billetero y placa con las mismas librerias vendor del proyecto
 * - Activar recepcion de billetes y monedas
 * - Mostrar en consola eventos interpretados y datos crudos del billetero
 * - Dejar una base fiable para validar tramas antes de ajustar cash_inventory
 *
 * Uso:
 *   node scripts/diag-cash-hardware.js
 *   node scripts/diag-cash-hardware.js --bills-only
 *   node scripts/diag-cash-hardware.js --board-only
 *   node scripts/diag-cash-hardware.js --accept=1000,2000,5000
 *
 * Salida esperada:
 * - Puerto resuelto para cada dispositivo
 * - Estado de conexion
 * - Eventos de billetes aceptados / pending / returned
 * - Eventos de monedas y billetes reportados por la placa
 * - Datos crudos del billetero que no coincidan con patrones conocidos
 */

const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');

const BILL_VENDOR_PATH = path.join(
  process.cwd(),
  'vendor',
  'peripherals',
  'coins-tech-coins-bill-validator-1.0.2',
  'dist',
  'bill-validator',
  'bill-validator.js',
);

const BOARD_VENDOR_PATH = path.join(
  process.cwd(),
  'vendor',
  'peripherals',
  'coins-tech-coins-electronic-board-1.0.6',
  'dist',
  'electronic-board',
  'electronic-board.js',
);

const billValidator = require(BILL_VENDOR_PATH).default;
const electronicBoard = require(BOARD_VENDOR_PATH).default;

const KNOWN_BILL_DENOMS = [1000, 2000, 5000, 10000, 20000, 50000, 100000];

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).split('#')[0].trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  const acceptArg = argv.find((item) => item.startsWith('--accept='));
  const acceptDenoms = acceptArg
    ? acceptArg
        .split('=')[1]
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0)
    : KNOWN_BILL_DENOMS;

  return {
    help: flags.has('--help') || flags.has('-h'),
    billsOnly: flags.has('--bills-only'),
    boardOnly: flags.has('--board-only'),
    acceptDenoms,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolvePort({ vendorId, productId, fallbackPort, deviceName }) {
  if (vendorId) {
    const ports = await SerialPort.list();
    const match = ports.find(
      (port) =>
        port.vendorId?.toLowerCase() === vendorId.toLowerCase() &&
        (!productId || port.productId?.toLowerCase() === productId.toLowerCase()),
    );
    if (match) {
      console.log(
        `[PORT] ${deviceName}: ${match.path} (VID:${match.vendorId} PID:${match.productId})`,
      );
      return match.path;
    }
  }

  if (fallbackPort) {
    console.log(`[PORT] ${deviceName}: ${fallbackPort} (fallback por .env)`);
    return fallbackPort;
  }

  console.log(`[PORT] ${deviceName}: no resuelto`);
  return null;
}

function buildBillMask(acceptedDenominations) {
  const accepted = new Set(acceptedDenominations);
  return KNOWN_BILL_DENOMS.reduce((mask, denomination, index) => {
    if (!accepted.has(denomination)) {
      return mask;
    }
    return mask | (1 << index);
  }, 0);
}

function banner(title) {
  console.log('');
  console.log('='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

function printHelp() {
  console.log('Uso:');
  console.log('  npm run diag:cash');
  console.log('  npm run diag:cash -- --bills-only');
  console.log('  npm run diag:cash -- --board-only');
  console.log('  npm run diag:cash -- --accept=1000,2000,5000');
  console.log('');
  console.log('Opciones:');
  console.log('  --bills-only   Conecta solo el billetero');
  console.log('  --board-only   Conecta solo la placa electronica');
  console.log('  --accept=...   Limita denominaciones habilitadas en el billetero');
  console.log('  --help         Muestra esta ayuda');
}

async function main() {
  loadEnvFile();
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }
  const connectBillValidator = !options.boardOnly;
  const connectBoard = !options.billsOnly;

  banner('DIAGNOSTICO DE HARDWARE DE EFECTIVO PPE');
  console.log(`Modo billetero : ${connectBillValidator ? 'ACTIVO' : 'OMITIDO'}`);
  console.log(`Modo placa     : ${connectBoard ? 'ACTIVA' : 'OMITIDA'}`);
  console.log(`Billetes permitidos para prueba: ${options.acceptDenoms.join(', ')}`);

  const billPort = connectBillValidator
    ? await resolvePort({
        vendorId: process.env.BILL_VALIDATOR_USB_VID ?? '',
        productId: process.env.BILL_VALIDATOR_USB_PID ?? '',
        fallbackPort: process.env.BILL_VALIDATOR_PORT ?? '',
        deviceName: 'Billetero',
      })
    : null;

  const boardPort = connectBoard
    ? await resolvePort({
        vendorId: process.env.ELECTRONIC_BOARD_USB_VID ?? '',
        productId: process.env.ELECTRONIC_BOARD_USB_PID ?? '',
        fallbackPort: process.env.ELECTRONIC_BOARD_PORT ?? '',
        deviceName: 'Placa electronica',
      })
    : null;

  if (connectBillValidator && !billPort) {
    throw new Error(
      'No fue posible resolver el puerto del billetero. Revise BILL_VALIDATOR_USB_VID/BILL_VALIDATOR_USB_PID o BILL_VALIDATOR_PORT.',
    );
  }

  if (connectBoard && !boardPort) {
    throw new Error(
      'No fue posible resolver el puerto de la placa. Revise ELECTRONIC_BOARD_USB_VID/ELECTRONIC_BOARD_USB_PID o ELECTRONIC_BOARD_PORT.',
    );
  }

  if (connectBillValidator) {
    billValidator.onBillReceived((amount) => {
      console.log(`[BILL][ACCEPTED] ${amount}`);
    });
    if (typeof billValidator.onBillPending === 'function') {
      billValidator.onBillPending((amount) => {
        console.log(`[BILL][PENDING] ${amount}`);
      });
    }
    if (typeof billValidator.onBillReturned === 'function') {
      billValidator.onBillReturned((amount) => {
        console.log(`[BILL][RETURNED] ${amount}`);
      });
    }
    if (typeof billValidator.onData === 'function') {
      billValidator.onData((raw) => {
        console.log(`[BILL][RAW] ${raw}`);
      });
    }
    billValidator.onError((message) => {
      console.log(`[BILL][ERROR] ${message}`);
    });

    banner('CONECTANDO BILLETERO');
    await billValidator.connect(billPort);
    console.log(`[BILL] Conectado en ${billPort}`);
    await sleep(300);

    if (typeof billValidator.reset === 'function') {
      try {
        billValidator.reset();
        console.log('[BILL] Reset enviado');
        await sleep(300);
      } catch (error) {
        console.log(`[BILL] Reset no disponible o fallo: ${error.message}`);
      }
    }

    if (typeof billValidator.setupCommand === 'function') {
      try {
        billValidator.setupCommand();
        console.log('[BILL] Setup enviado');
        await sleep(300);
      } catch (error) {
        console.log(`[BILL] Setup no disponible o fallo: ${error.message}`);
      }
    }

    if (typeof billValidator.billCommand === 'function') {
      const mask = buildBillMask(options.acceptDenoms);
      billValidator.billCommand(mask, 0);
      console.log(`[BILL] Aceptacion activada con mascara ${mask} -> [${options.acceptDenoms.join(', ')}]`);
    } else {
      billValidator.activate();
      console.log('[BILL] activate() enviado');
    }
  }

  if (connectBoard) {
    electronicBoard.onCoinReceived((amount) => {
      console.log(`[BOARD][COIN] ${amount}`);
    });
    electronicBoard.onBillReceived((amount) => {
      console.log(`[BOARD][BILL] ${amount}`);
    });
    electronicBoard.onError((message) => {
      console.log(`[BOARD][ERROR] ${message}`);
    });

    banner('CONECTANDO PLACA ELECTRONICA');
    await electronicBoard.connect(boardPort);
    console.log(`[BOARD] Conectada en ${boardPort}`);
    await sleep(300);
    electronicBoard.activate();
    console.log('[BOARD] activate() enviado');
  }

  banner('RECEPTORES ACTIVOS');
  console.log('Inserte ahora billetes o monedas.');
  console.log('Este script mostrara eventos interpretados por las librerias vendor.');
  console.log('Nota: la libreria de la placa ya imprime sus tramas crudas en consola.');
  console.log('Use Ctrl+C para terminar la prueba.');

  const shutdown = async () => {
    banner('CIERRE DE DIAGNOSTICO');
    try {
      if (connectBillValidator) {
        try {
          billValidator.deactivate();
        } catch {}
        try {
          billValidator.disconnect();
        } catch {}
        console.log('[BILL] Desconectado');
      }
      if (connectBoard) {
        try {
          electronicBoard.deactivate();
        } catch {}
        try {
          electronicBoard.disconnect();
        } catch {}
        console.log('[BOARD] Desconectada');
      }
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('');
  console.error('[FATAL]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
