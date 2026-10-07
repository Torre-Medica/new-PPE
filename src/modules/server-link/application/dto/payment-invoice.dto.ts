// Factura de un pago tal como la entrega nexo_back en GET /printForId
// (la misma que imprime la caja del servidor).
export interface PaymentInvoiceLine {
  CANTIDAD?: number | string;
  DESCRIPCION?: string;
  VALOR?: number | string;
  IVA?: number | string;
}

export interface PaymentInvoiceTotals {
  CANTIDAD_TOTAL?: number | string;
  BASE?: number | string;
  DESCUENTO?: number | string;
  SUBTOTAL?: number | string;
  IVA_19?: number | string;
  TOTAL?: number | string;
  RECIBIDO?: number | string;
  CAMBIO?: number | string;
}

export interface PaymentInvoice {
  empresa?: string;
  nit?: string;
  direccion?: string;
  header?: {
    FACTURA_ELECTRONICA_DE_VENTA?: string;
    FECHA_DE_VENTA?: string;
    REGIMEN?: string;
    CLIENTE?: string;
    NIT?: string;
    FORMA_DE_PAGO?: string;
    MEDIO_DE_PAGO?: string;
    PLACA?: string;
    FECHA_DE_INGRESO?: string;
    DURACION?: string;
    PUNTO_DE_PAGO?: string;
    FECHA_INICIO_MENSUALIDAD?: string;
    FECHA_FIN_MENSUALIDAD?: string;
    TIEMPO_PAGADO_MENSUALIDAD?: string;
  };
  description?: PaymentInvoiceLine[];
  descriptionTotal?: PaymentInvoiceTotals[];
  infoResolution?: string;
  infoSoftwareManufacturer?: string;
  infoTechnologyProvider?: string;
  infoPolice?: string;
  infoCufe?: { CUFE?: string | null; URL?: string | null };
}
