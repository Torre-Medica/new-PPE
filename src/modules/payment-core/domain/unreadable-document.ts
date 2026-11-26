const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/**
 * Lectura que no corresponde a ningun formato conocido (tiquete UUID, cedula
 * o tag numerico, QR Uniminuto JWT, URL): se asume un documento que el lector
 * no interpreta, como el QR de la cedula nueva, y se pide digitar la cedula.
 * Los codigos cortos (ej. RPT-ABC123) no cuentan: pueden ser tiquetes reales.
 */
export function looksLikeUnreadableDocument(code: string): boolean {
  const value = code.trim();
  if (value.length < 20) return false;
  if (UUID.test(value) || JWT.test(value) || /^\d+$/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  // Tags UHF: solo hexadecimal
  if (/^[0-9A-F]+$/i.test(value)) return false;
  return true;
}
