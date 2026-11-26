import { looksLikeUnreadableDocument } from './unreadable-document';

describe('looksLikeUnreadableDocument', () => {
  it.each([
    ['e67a91bf-5278-4137-b219-1713f252035a', 'tiquete UUID'],
    ['7770000005', 'cedula'],
    ['E2000017221101441890ABCD', 'tag UHF'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123_-', 'QR Uniminuto (JWT)'],
    ['https://parqueadero.com/pago?companyCode=1', 'URL'],
    ['RPT-RPTA75', 'codigo corto'],
  ])('%s (%s) no pide cedula', (code) => {
    expect(looksLikeUnreadableDocument(code)).toBe(false);
  });

  it('un contenido largo desconocido (ej. QR de cedula nueva) si pide cedula', () => {
    expect(looksLikeUnreadableDocument('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAh+/=')).toBe(true);
  });
});
