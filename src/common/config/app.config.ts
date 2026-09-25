import { resolveDefaultDatabasePath } from '@common/config/database-path';

const readBooleanEnv = (value: string | undefined, defaultValue = false) => {
  if (value === undefined) {
    return defaultValue;
  }

  return value.trim().toLowerCase() === 'true';
};

export const appConfig = () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    apiPrefix: process.env.API_PREFIX ?? 'api',
    headlessMode: process.env.PPE_HEADLESS_MODE === 'true',
  },
  features: {
    electronicBillingEnabled: readBooleanEnv(process.env.FACTURACION, false),
    monthlySubscriptionsEnabled: readBooleanEnv(process.env.MENSUALIDADES, false),
  },
  database: {
    path: resolveDefaultDatabasePath(),
    logging: process.env.TYPEORM_LOGGING === 'true',
  },
  serverLink: {
    url: process.env.SERVER_LINK_URL ?? 'http://localhost:3001',
    namespace: process.env.SERVER_LINK_NAMESPACE ?? '/',
    deviceUuid: process.env.PPE_DEVICE_UUID ?? '',
    deviceSecret: process.env.PPE_DEVICE_SECRET ?? '',
    restAuthKey: process.env.NEXO_BACK_KEY_CRYPTO ?? '',
  },
  localApi: {
    adminKey: process.env.LOCAL_API_ADMIN_KEY ?? '',
    operatorKey: process.env.LOCAL_API_OPERATOR_KEY ?? '',
    auditKey: process.env.LOCAL_API_AUDIT_KEY ?? '',
  },
  auth: {
    jwtSecret: process.env.PPE_JWT_SECRET ?? 'changeme',
    jwtExpiresIn: process.env.PPE_JWT_EXPIRES_IN ?? '4h',
  },
  printing: {
    javaServerUrl: process.env.PRINTER_JAVA_SERVER_URL ?? 'http://localhost:8080/imprimir',
    printerName: process.env.PRINTER_NAME ?? 'printer',
    machineName: process.env.PPE_MACHINE_NAME ?? 'PPE',
  },
  payment: {
    sessionValidatingTimeoutMs: process.env.PAYMENT_SESSION_VALIDATING_TIMEOUT_MS
      ? Number(process.env.PAYMENT_SESSION_VALIDATING_TIMEOUT_MS)
      : 15_000,
    sessionReviewTimeoutMs: process.env.PAYMENT_SESSION_REVIEW_TIMEOUT_MS
      ? Number(process.env.PAYMENT_SESSION_REVIEW_TIMEOUT_MS)
      : 30_000,
    sessionCashTimeoutMs: process.env.PAYMENT_SESSION_CASH_TIMEOUT_MS
      ? Number(process.env.PAYMENT_SESSION_CASH_TIMEOUT_MS)
      : 30_000,
    sessionBillingDetailsTimeoutMs: process.env.PAYMENT_SESSION_BILLING_DETAILS_TIMEOUT_MS
      ? Number(process.env.PAYMENT_SESSION_BILLING_DETAILS_TIMEOUT_MS)
      : 300_000,
    sessionMonthlySubscriptionTimeoutMs: process.env.PAYMENT_SESSION_MONTHLY_SUBSCRIPTION_TIMEOUT_MS
      ? Number(process.env.PAYMENT_SESSION_MONTHLY_SUBSCRIPTION_TIMEOUT_MS)
      : 120_000,
    sessionFinalizingTimeoutMs: process.env.PAYMENT_SESSION_FINALIZING_TIMEOUT_MS
      ? Number(process.env.PAYMENT_SESSION_FINALIZING_TIMEOUT_MS)
      : 30_000,
  },
  peripherals: {
    simulateHardware: readBooleanEnv(process.env.SIMULATE_HARDWARE, false),
    billValidatorLegacyPath: process.env.BILL_VALIDATOR_LEGACY_PATH ?? '',
    electronicBoardLegacyPath: process.env.ELECTRONIC_BOARD_LEGACY_PATH ?? '',
    qrScannerPort: process.env.QR_SCANNER_PORT ?? '',
    qrScannerBaudRate: process.env.QR_SCANNER_BAUD_RATE
      ? Number(process.env.QR_SCANNER_BAUD_RATE)
      : 115200,
    qrScannerDuplicateCooldownMs: process.env.QR_SCANNER_DUPLICATE_COOLDOWN_MS
      ? Number(process.env.QR_SCANNER_DUPLICATE_COOLDOWN_MS)
      : 4_000,
    billValidatorPort: process.env.BILL_VALIDATOR_PORT ?? '',
    electronicBoardPort: process.env.ELECTRONIC_BOARD_PORT ?? '',
    electronicBoardUsbVid: process.env.ELECTRONIC_BOARD_USB_VID ?? '',
    electronicBoardUsbPid: process.env.ELECTRONIC_BOARD_USB_PID ?? '',
    qrScannerUsbVid: process.env.QR_SCANNER_USB_VID ?? '',
    qrScannerUsbPid: process.env.QR_SCANNER_USB_PID ?? '',
    billValidatorUsbVid: process.env.BILL_VALIDATOR_USB_VID ?? '',
    billValidatorUsbPid: process.env.BILL_VALIDATOR_USB_PID ?? '',
  },
});
