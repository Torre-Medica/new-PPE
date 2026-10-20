import { Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'dns';

export type ContactCheck = { valid: true } | { valid: false; reason: string };

// Errores de DNS que significan "ese dominio no existe / no tiene servidor de correo"
const MISSING_DOMAIN_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ESERVFAIL']);

// Maximo que espera el cliente en el kiosko por la consulta DNS
const DNS_TIMEOUT_MS = 3000;

/**
 * Validaciones de los datos de contacto del tercero de la factura antes de enviarlos a
 * Nexo: que el dominio del correo exista y reciba correo, y que el telefono (opcional)
 * tenga 10 digitos.
 */
@Injectable()
export class BillingContactValidationService {
  private readonly logger = new Logger(BillingContactValidationService.name);

  /**
   * El dominio del correo debe tener servidor de correo (MX) o, en su defecto, una
   * direccion (A/AAAA). Si no se puede consultar (sin internet, DNS lento) no se
   * bloquea al cliente: solo se rechaza cuando el DNS responde que no existe.
   */
  async checkEmail(email: string): Promise<ContactCheck> {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      return { valid: false, reason: 'Correo inválido' };
    }
    const domain = value.split('@')[1];

    try {
      const mx = await this.withTimeout(dns.resolveMx(domain));
      if (mx.some((record) => record.exchange && record.exchange !== '.')) return { valid: true };
      return { valid: false, reason: 'El dominio no recibe correos' };
    } catch (error) {
      const code = this.errorCode(error);
      if (code === 'TIMEOUT' || !MISSING_DOMAIN_CODES.has(code)) {
        this.logger.warn(`No se pudo verificar el dominio ${domain} (${code}); se acepta el correo`);
        return { valid: true };
      }
    }

    // Sin MX: un dominio con direccion propia tambien puede recibir correo
    try {
      await this.withTimeout(dns.lookup(domain));
      return { valid: true };
    } catch (error) {
      const code = this.errorCode(error);
      if (code === 'TIMEOUT' || !MISSING_DOMAIN_CODES.has(code)) return { valid: true };
      return { valid: false, reason: 'El dominio del correo no existe' };
    }
  }

  /** Direccion de facturacion: obligatoria al registrar (minimo 5 caracteres). */
  checkAddress(address?: string | null): ContactCheck {
    const value = (address ?? '').trim();
    if (!value) return { valid: false, reason: 'La dirección es obligatoria' };
    if (value.length < 5) return { valid: false, reason: 'La dirección es muy corta' };
    return { valid: true };
  }

  /** Opcional; si viene, 10 digitos (celular o fijo colombiano). */
  checkPhone(phone?: string | null): ContactCheck {
    const value = (phone ?? '').trim();
    if (!value) return { valid: true };
    if (!/^\d{10}$/.test(value)) {
      return { valid: false, reason: 'El teléfono debe tener 10 dígitos' };
    }
    return { valid: true };
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), DNS_TIMEOUT_MS),
      ),
    ]);
  }

  private errorCode(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'UNKNOWN';
  }
}
