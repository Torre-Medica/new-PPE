// Reglas de la facturacion a terceros en el kiosko: el cliente solo escribe su numero,
// nombre y correo; el resto se deduce o va por defecto.

export type BillingDocumentKind = 'CC' | 'NIT';

export interface BillingDocument {
  kind: BillingDocumentKind;
  // Numero sin digito de verificacion (asi se busca y se registra en Siigo)
  identification: string;
  // Solo NIT
  checkDigit: string | null;
}

// Digito de verificacion de un NIT colombiano (algoritmo DIAN, modulo 11)
export function nitCheckDigit(nit: string): string {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digits = nit.split('').reverse();
  const sum = digits.reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0);
  const rest = sum % 11;
  return String(rest > 1 ? 11 - rest : rest);
}

/**
 * Cedula o NIT segun el numero:
 * - 9 digitos que empiezan en 8 o 9 = NIT de empresa (se calcula el DV).
 * - 10 digitos que empiezan en 8 o 9 y cuyo ultimo digito es el DV correcto = NIT escrito con DV.
 * - Cualquier otro numero de 6 a 10 digitos = cedula.
 */
export function detectBillingDocument(value: string): BillingDocument | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 10) return null;

  const startsLikeNit = digits[0] === '8' || digits[0] === '9';
  if (startsLikeNit && digits.length === 9) {
    return { kind: 'NIT', identification: digits, checkDigit: nitCheckDigit(digits) };
  }
  if (startsLikeNit && digits.length === 10) {
    const base = digits.slice(0, 9);
    if (nitCheckDigit(base) === digits[9]) {
      return { kind: 'NIT', identification: base, checkDigit: digits[9] };
    }
  }
  return { kind: 'CC', identification: digits, checkDigit: null };
}

export function documentError(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return 'Ingrese su cédula o NIT';
  if (digits.length < 6 || digits.length > 10) return 'Número inválido';
  return null;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * Nombre completo de persona -> nombres y apellidos (Siigo los pide separados).
 * 2 palabras: 1 + 1 · 3 palabras: 1 + 2 · 4 o mas: mitad y mitad.
 */
export function splitPersonName(fullName: string): { firstName: string; lastName: string } | null {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const firstCount = words.length === 3 ? 1 : Math.ceil(words.length / 2);
  return {
    firstName: words.slice(0, firstCount).join(' '),
    lastName: words.slice(firstCount).join(' '),
  };
}

// "JUAN PEREZ GOMEZ" -> "JUAN P*****"
export function maskName(name: string): string {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[1][0]}*****`;
}

// CC ******4050 · NIT *****852-1
export function maskDocument(document: BillingDocument): string {
  const visible = document.identification.slice(-4);
  const hidden = '*'.repeat(Math.max(document.identification.length - 4, 2));
  const dv = document.kind === 'NIT' && document.checkDigit ? `-${document.checkDigit}` : '';
  return `${document.kind} ${hidden}${visible}${dv}`;
}

// "juanperez@gmail.com" -> "j****@gmail.com"
export function maskEmail(email: string): string {
  const [user, domain] = email.trim().split('@');
  if (!user || !domain) return '';
  return `${user[0]}****@${domain}`;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// Nombre del tercero en la respuesta de busqueda (Siigo o el directorio de empresas)
export function customerDisplayName(data: Record<string, unknown>): string {
  const name = data.name;
  if (Array.isArray(name)) {
    const joined = name.filter((part) => typeof part === 'string').join(' ').trim();
    if (joined) return joined;
  }
  if (typeof name === 'string' && name.trim()) return name.trim();
  const personName = `${asText(data.first_name)} ${asText(data.last_name)}`.trim();
  if (personName) return personName;
  return asText(data.razonSocial) || asText(data.commercial_name);
}

// Correo del tercero en la respuesta de busqueda, si viene
export function customerEmail(data: Record<string, unknown>): string {
  const direct = asText(data.email) || asText(data.mail);
  if (direct) return direct;
  const contacts = data.contacts;
  if (Array.isArray(contacts)) {
    for (const contact of contacts) {
      if (contact && typeof contact === 'object') {
        const email = asText((contact as Record<string, unknown>).email);
        if (email) return email;
      }
    }
  }
  return '';
}

// Busca en el catalogo el tipo de documento (cedula de ciudadania o NIT)
export function identificationTypeId(
  kind: BillingDocumentKind,
  types: Array<{ id: number; identification: string }>,
): number | null {
  const normalize = (value: string) =>
    value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const match = types.find((type) => {
    const label = normalize(type.identification);
    return kind === 'NIT' ? /\bnit\b/.test(label) : label.includes('cedula') && label.includes('ciudadan');
  });
  return match?.id ?? null;
}

// Ciudad por defecto (variable del PPE) en el catalogo de ciudades
export function defaultCityId(
  cityName: string,
  cities: Array<{ id: number; cityName: string }>,
): number | null {
  const normalize = (value: string) =>
    value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const wanted = normalize(cityName);
  return cities.find((city) => normalize(city.cityName) === wanted)?.id ?? null;
}

// Telefono del tercero en la respuesta de busqueda, si viene
export function customerPhone(data: Record<string, unknown>): string {
  const direct = asText(data.phone) || asText(data.number_phone) || asText(data.phoneNumber);
  if (direct) return direct;
  const contacts = data.contacts;
  if (Array.isArray(contacts)) {
    for (const contact of contacts) {
      if (contact && typeof contact === 'object') {
        const phone = (contact as Record<string, unknown>).phone;
        if (typeof phone === 'string' && phone.trim()) return phone.trim();
        if (phone && typeof phone === 'object') {
          const number = asText((phone as Record<string, unknown>).number);
          if (number) return number;
        }
      }
    }
  }
  return '';
}

// "3001234567" -> "*******567"
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `${'*'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}
