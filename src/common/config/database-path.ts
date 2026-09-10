export function resolveDefaultDatabasePath(): string {
  const configuredPath = process.env.DATABASE_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  throw new Error(
    'DATABASE_PATH no esta configurado. Defina una unica ruta SQLite en el archivo .env del PPE.',
  );
}
