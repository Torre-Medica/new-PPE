# Endpoints y Eventos PPE

## 1. Objetivo

Este documento describe como se comunica el frontend del `PPE` con el backend local.

Regla actual:

- el frontend no habla directo con la base de datos
- el frontend no usa `WebSocket` ni `Socket.IO`
- el frontend usa:
  - `HTTP/JSON` sobre `/api/...`
  - `SSE` mediante `EventSource('/api/kiosk/events')`

Archivos de referencia:

- [frontend/src/lib/api.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\frontend\src\lib\api.ts)
- [frontend/src/App.tsx](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\frontend\src\App.tsx)
- [src/modules/kiosk/interfaces/http/kiosk.controller.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\kiosk\interfaces\http\kiosk.controller.ts)

## 2. Patron de conexion

### 2.1 HTTP

El frontend usa `fetch` contra rutas relativas:

- `/api/auth/...`
- `/api/kiosk/...`
- `/api/cash/...`
- `/api/dispensers/...`
- `/api/devices/...`
- `/api/server-link/...`
- `/api/payments/...`

En desarrollo, `Vite` hace proxy de `/api` hacia el backend PPE segun:

- `PORT`: puerto del backend
- `FRONTEND_PORT`: puerto del frontend

Archivo:

- [frontend/vite.config.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\frontend\vite.config.ts)

### 2.2 SSE

El frontend abre una conexion:

- `GET /api/kiosk/events`

Implementacion:

- `EventSource('/api/kiosk/events')`

Uso:

- eventos de sesion de pago en vivo
- cambios de modo del kiosko
- muestras del collector en pruebas de receptores
- advertencias operativas de cambio bajo

## 3. Autenticacion

### 3.1 Endpoints publicos

No requieren `Bearer token`:

- `POST /api/auth/login`
- `GET /api/kiosk/state`
- `GET /api/kiosk/active-session`
- `GET /api/kiosk/events`
- `POST /api/kiosk/mode`
- `POST /api/kiosk/payment-sessions/:id/collect`
- `POST /api/kiosk/payment-sessions/:id/cancel`
- `POST /api/kiosk/payment-sessions/:id/touch`
- `POST /api/kiosk/payment-sessions/:id/print-receipt`

### 3.2 Endpoints administrativos

Requieren `Authorization: Bearer <token>` despues de:

- `POST /api/auth/login`

Roles del backend:

- `Admin`
- `Operator`
- `Audit`

## 4. Endpoints usados por el frontend

Esta seccion lista los endpoints que la UI actual consume de forma directa.

### 4.1 Autenticacion

#### `POST /api/auth/login`

Uso en frontend:

- login de la vista administrativa

Body:

```json
{
  "email": "soporte@coins-colombia.com",
  "password": "******"
}
```

Respuesta esperada:

```json
{
  "accessToken": "jwt"
}
```

### 4.2 Kiosko y flujo de pago

#### `GET /api/kiosk/state`

Uso:

- carga inicial del frontend
- saber si el PPE esta en modo `PAYMENT` o `MAINTENANCE`

#### `POST /api/kiosk/mode`

Uso:

- cambiar entre modo pago y mantenimiento

Body:

```json
{
  "mode": "PAYMENT",
  "changedBy": "frontend-selector"
}
```

#### `GET /api/kiosk/active-session`

Uso:

- recuperar sesion activa si el frontend se recarga o si ya habia un cobro arrancado

Puede responder:

- `204 No Content`
- objeto `KioskSessionSummary`

Campos relevantes:

- `paymentSessionId`
- `status`
- `identifierLabel`
- `identifierValue`
- `targetAmount`
- `insertedAmount`
- `changeAmount`
- `enteredAt`
- `acceptancePolicy`

#### `POST /api/kiosk/payment-sessions/:id/collect`

Uso:

- habilitar recepcion fisica de efectivo despues de revisar el valor del cobro

Body:

```json
{
  "initiatedBy": "touch-kiosk"
}
```

#### `POST /api/kiosk/payment-sessions/:id/cancel`

Uso:

- cancelar la sesion visible en PPE
- tiempo agotado en pantalla de revision

#### `POST /api/kiosk/payment-sessions/:id/touch`

Uso:

- extender actividad de la sesion de cobro
- se llama cuando el usuario toca pantalla durante la etapa de insercion

#### `POST /api/kiosk/payment-sessions/:id/print-receipt`

Uso:

- impresion del recibo al finalizar el pago

### 4.3 Caja

#### `GET /api/cash/denominations`

Uso:

- poblar denominaciones en dashboard administrativo

#### `GET /api/cash/inventory`

Uso:

- consultar `cash_inventory`

#### `POST /api/cash/load`

Uso:

- cargue manual global a `cash_inventory`

Nota:

- el frontend actual de slots individuales ya no depende del bloque global para operar slot por slot

#### `POST /api/cash/unload`

Uso:

- descargue manual global a `cash_inventory`

#### `GET /api/cash/movements`

Uso:

- listar movimientos de caja

#### `GET /api/cash/dashboard`

Uso:

- resumen administrativo
- cambio disponible
- recaudo del dia
- ultimo cierre

#### `GET /api/cash/closeouts?limit=5`

Uso:

- historial reciente de cierres

#### `POST /api/cash/closeouts`

Uso:

- crear cierre parcial o total

Body:

```json
{
  "closedBy": "soporte@coins-colombia.com",
  "closeoutType": "PARTIAL",
  "notes": "opcional"
}
```

#### `POST /api/cash/closeouts/:id/print`

Uso:

- reimprimir tirilla de cierre

### 4.4 Slots y dispensadores

#### `GET /api/dispensers/slots`

Uso:

- cargar slots `bill1`, `bill2`, `coin1`, `coin2`
- visualizar denominacion, cantidad y total por slot

#### `PATCH /api/dispensers/slots/:key`

Uso:

- cambiar denominacion del slot
- ajustar cantidad manual

Body tipico:

```json
{
  "denominationId": 5000,
  "quantity": 0
}
```

Regla de negocio importante:

- si el slot tiene `quantity > 0`, el backend bloquea cambio de denominacion

#### `POST /api/dispensers/slots/:key/load`

Uso:

- sumar unidades a un slot fisico
- registrar tambien movimiento de caja

Body tipico:

```json
{
  "quantity": 10,
  "reason": "carga inicial",
  "createdBy": "soporte@coins-colombia.com"
}
```

#### `POST /api/dispensers/slots/:key/unload`

Uso:

- restar unidades de un slot fisico
- registrar tambien movimiento de caja

#### `POST /api/dispensers/eject`

Uso:

- expulsar manualmente una o varias unidades de un slot

Body tipico:

```json
{
  "slotKey": "bill1",
  "quantity": 1
}
```

Respuesta esperada:

```json
{
  "slotKey": "bill1",
  "denominationId": 2000,
  "quantity": 1,
  "totalDispensed": 2000
}
```

#### `GET /api/dispensers/collector-test`

Uso:

- consultar estado del modo de prueba de receptores

#### `POST /api/dispensers/collector-test/start`

Uso:

- activar prueba de receptores desde dashboard

Body:

```json
{
  "initiatedBy": "soporte@coins-colombia.com"
}
```

Restriccion:

- el backend lo bloquea si existe una sesion de pago activa

#### `POST /api/dispensers/collector-test/stop`

Uso:

- apagar prueba de receptores

### 4.5 Dispositivos y enlace al servidor

#### `GET /api/devices`

Uso:

- estado de placa, QR e impresora en dashboard

#### `GET /api/server-link/status`

Uso:

- ver estado del enlace PPE -> `nexo_back`

### 4.6 Pagos completados

#### `GET /api/payments/completed/search?dateFrom=...&dateTo=...`

Uso:

- tabla de pagos completados del dia en la vista administrativa

## 5. Endpoints disponibles en backend que hoy no usa el frontend principal

Estos endpoints existen y sirven para operacion, soporte o integraciones, aunque la UI principal no los llama hoy:

- `POST /api/payments/start`
- `POST /api/payments/cancel/:id`
- `POST /api/payments/:id/collect`
- `POST /api/payments/:id/cash`
- `POST /api/payments/:id/complete`
- `POST /api/payments/sync/retry`
- `GET /api/payments/completed/by-qr/:qrCode`
- `GET /api/payments/active`
- `GET /api/payments/:id/events`
- `GET /api/payments/:id`
- `GET /api/devices/qr/last-scan`
- `POST /api/devices/connect`
- `POST /api/devices/connect-all`
- `POST /api/devices/disconnect-all`

## 6. SSE del PPE

### 6.1 Endpoint

#### `GET /api/kiosk/events`

Controlador:

- [src/modules/kiosk/interfaces/http/kiosk.controller.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\kiosk\interfaces\http\kiosk.controller.ts)

Servicio emisor:

- [src/modules/kiosk/application/kiosk-events.service.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\kiosk\application\kiosk-events.service.ts)

Formato general del evento:

```json
{
  "type": "session.review-ready",
  "timestamp": "2026-06-12T15:20:00.000Z",
  "...": "payload especifico"
}
```

### 6.2 Eventos SSE que el frontend escucha hoy

#### `session.review-ready`

Uso en UI:

- un QR valido ya abrio sesion
- el frontend pasa a pantalla de revision

Campos usados por el frontend:

- `paymentSessionId`
- `identifierLabel`
- `identifierValue`
- `targetAmount`
- `enteredAt`
- `concept`
- `acceptancePolicy`

#### `session.collecting-enabled`

Uso en UI:

- pasa a pantalla de insercion de efectivo

Campos usados:

- `paymentSessionId`
- `insertedAmount`
- `targetAmount`
- `acceptancePolicy`

#### `cash.received`

Uso en UI:

- actualizar total insertado y devuelta calculada en vivo

Campos usados:

- `insertedAmount`
- `targetAmount`
- `acceptancePolicy`

#### `session.completed`

Uso en UI:

- pasar a pantalla final
- mostrar efectivo recibido y cambio entregado

Campos usados:

- `paymentSessionId`
- `insertedAmount`
- `targetAmount`
- `changeAmount`

#### `machine.low-change-warning`

Uso en UI:

- refrescar advertencias de pago exacto o cambio limitado

Campo usado:

- `acceptancePolicy`

#### `collector.sample-received`

Uso en UI:

- poblar la tarjeta `Collector live` en prueba de receptores

Campos usados:

- `amount`
- `kind`
- `source`
- `receivedAt`

#### `session.timeout`

Uso en UI:

- volver a estado inicial

#### `session.canceled`

Uso en UI:

- volver a estado inicial

#### `kiosk.mode.changed`

Uso en UI:

- alternar entre pantalla de pago y mantenimiento

Campo usado:

- `mode`

### 6.3 Eventos SSE emitidos por backend que hoy el frontend no consume

#### `qr.ignored`

Uso actual:

- diagnostico y trazabilidad cuando el QR no genera sesion

#### `kiosk.payment-lock.changed`

Uso actual:

- observabilidad de bloqueo/desbloqueo de pagos

## 7. Relacion pantalla -> canal backend

### 7.1 Pantalla de pago

Usa:

- `GET /api/kiosk/state`
- `GET /api/kiosk/active-session`
- `GET /api/kiosk/events`
- `POST /api/kiosk/payment-sessions/:id/collect`
- `POST /api/kiosk/payment-sessions/:id/cancel`
- `POST /api/kiosk/payment-sessions/:id/touch`
- `POST /api/kiosk/payment-sessions/:id/print-receipt`

### 7.2 Vista administrativa

Usa:

- `POST /api/auth/login`
- `GET /api/cash/dashboard`
- `GET /api/cash/movements`
- `GET /api/cash/closeouts`
- `GET /api/cash/denominations`
- `GET /api/dispensers/slots`
- `PATCH /api/dispensers/slots/:key`
- `POST /api/dispensers/slots/:key/load`
- `POST /api/dispensers/slots/:key/unload`
- `POST /api/dispensers/eject`
- `GET /api/devices`
- `GET /api/server-link/status`
- `GET /api/payments/completed/search`
- `GET /api/dispensers/collector-test`
- `POST /api/dispensers/collector-test/start`
- `POST /api/dispensers/collector-test/stop`
- `GET /api/kiosk/events`

## 8. Conclusion operativa

Para el frontend actual del PPE:

- la fuente principal son endpoints HTTP del backend local
- el canal en vivo es `SSE`
- no hay acceso directo a SQLite desde React
- no hay otro mecanismo de comunicacion paralelo distinto de `HTTP + SSE`
