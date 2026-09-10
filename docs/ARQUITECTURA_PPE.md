# Arquitectura Propuesta del PPE

## Vision general
El `PPE` sera un backend `NestJS` modular con `SQLite` local, enfocado en cobro desatendido en efectivo y sincronizacion en tiempo real con `nexo_back`.

## Diagrama logico
```text
                      +----------------------+
                      |     Frontend PPE     |
                      | pantalla / operador  |
                      +----------+-----------+
                                 |
                                 v
                      +----------------------+
                      |      Local API       |
                      | controllers REST     |
                      +----------+-----------+
                                 |
                                 v
                    +------------+-------------+
                    |      Payment Core        |
                    | casos de uso del cobro   |
                    +-----+---------------+----+
                          |               |
                          |               |
                          v               v
              +------------------+   +------------------+
              |   Peripherals    |   |   Server Link    |
              | QR/billetero/    |   | socket.io client |
              | monedero/hopper  |   | hacia nexo_back  |
              +--------+---------+   +---------+--------+
                       |                       |
                       v                       v
                +--------------------------------------+
                |         SQLite / Persistence         |
                | auditoria, sesiones, efectivo, logs  |
                +--------------------------------------+
```

## Capas

### Presentacion
- Controladores REST locales.
- Endpoints de monitoreo y consulta.
- Endpoints operativos para iniciar, cancelar y consultar cobros.

### Aplicacion
- Casos de uso:
  - validar ticket
  - iniciar sesion
  - aceptar dinero
  - calcular faltante
  - calcular cambio
  - devolver cambio
  - confirmar pago al servidor
  - cerrar sesion
  - registrar arqueos y recargas

### Dominio
- Reglas de negocio del cobro.
- Maquina de estados de sesion.
- Politicas de inventario.
- Politicas de conciliacion con servidor.

### Infraestructura
- SQLite con TypeORM.
- Cliente `socket.io`.
- Adaptadores de hardware.
- Logs y auditoria.

## Modulos

### 1. `server-link`
Responsabilidad:
- conectar el `PPE` con `nexo_back`
- autenticarse por `uuid`
- enviar solicitudes de validacion
- enviar confirmaciones de pago
- recibir respuestas del servidor

Interfaces principales:
- `validatePaymentCandidate`
- `commitPayment`
- `cancelPayment`
- `ping`

Notas:
- Debe minimizar cambios en `nexo_back`.
- Debe usar idempotencia por `ppeTransactionUuid`.

### 2. `payment-core`
Responsabilidad:
- orquestar de punta a punta el ciclo de pago
- mantener la maquina de estados
- consolidar efectivo recibido
- ordenar devolucion
- persistir auditoria

Estados sugeridos:
- `CREATED`
- `VALIDATING`
- `VALIDATED`
- `LISTENING_CASH`
- `CHANGE_PENDING`
- `DISPENSING_CHANGE`
- `READY_TO_COMMIT`
- `COMMITTING_TO_SERVER`
- `COMPLETED`
- `COMPLETED_WITH_WARNING`
- `CANCELED`
- `FAILED`
- `TIMEOUT`

### 3. `peripherals`
Responsabilidad:
- encapsular comunicacion con lector QR, billetero, monedero, hopper y placa electronica

Puertos logicos:
- `QrScannerPort`
- `CashAcceptorPort`
- `CoinAcceptorPort`
- `ChangeDispenserPort`
- `PeripheralSupervisorPort`

Implementaciones previstas:
- legacy company library
- SDK comercial futuro

### 4. `cash-management`
Responsabilidad:
- administrar inventario de efectivo por denominacion
- registrar recargas
- registrar descargas
- registrar dinero aceptado
- registrar dinero dispensado
- exponer disponibilidad real para devolucion

### 5. `local-api`
Responsabilidad:
- exponer consultas y operaciones locales

Grupos de endpoints:
- `system`
- `devices`
- `cash`
- `payments`
- `audit`

### 6. `persistence`
Responsabilidad:
- entidades
- migraciones
- repositorios
- seed inicial de denominaciones

### 7. `audit`
Responsabilidad:
- registrar eventos de negocio y eventos tecnicos
- dejar trazabilidad completa por sesion

## Modelo de comunicacion con `nexo_back`

### Validacion
El `PPE` envia:
- `qrCode` o `plate`
- `deviceUuid`
- `ppeTransactionUuid`

El servidor responde:
- `processId`
- `total`
- `concept`
- `vehiclePlate`
- `vehicleType`
- `paidStatus`
- `allowedToExit`

### Confirmacion de pago
El `PPE` envia:
- `ppeTransactionUuid`
- `processId`
- `qrCode`
- `plate`
- `total`
- `cashReceived`
- `changeDelivered`
- `paymentBreakdown`
- `deviceUuid`

El servidor responde:
- `serverPaymentId`
- `paymentRegistered`
- `paidDatetime`
- `allowedToExit`

## MER resumido
```text
Denomination
  1 --- 1 CashInventory
  1 --- N CashMovement
  1 --- N PaymentLine

PaymentSession
  1 --- N PaymentSessionEvent
  1 --- N PaymentLine
  1 --- N ServerSyncAttempt
  1 --- N CashMovement

Device
  1 --- N DeviceHealthLog
```

## Entidades principales

### `denominations`
- `id`
- `kind`
- `currency`
- `isActive`

### `cash_inventory`
- `denominationId`
- `quantity`
- `minThreshold`
- `maxThreshold`
- `updatedAt`

### `cash_movements`
- `id`
- `type`
- `denominationId`
- `quantity`
- `unitValue`
- `totalValue`
- `reason`
- `paymentSessionId`
- `createdBy`
- `createdAt`

### `payment_sessions`
- `id` as `ppeTransactionUuid`
- `serverProcessId`
- `serverPaymentId`
- `serverSyncStatus`
- `qrCode`
- `vehiclePlate`
- `vehicleType`
- `targetAmount`
- `insertedAmount`
- `changeAmount`
- `status`
- `startedAt`
- `completedAt`
- `failureReason`

### `payment_lines`
- `id`
- `paymentSessionId`
- `denominationId`
- `quantity`
- `subtotal`

### `payment_session_events`
- `id`
- `paymentSessionId`
- `type`
- `amount`
- `payloadJson`
- `createdAt`

### `server_sync_attempts`
- `id`
- `paymentSessionId`
- `requestType`
- `requestJson`
- `responseJson`
- `status`
- `createdAt`

### `devices`
- `id`
- `code`
- `name`
- `type`
- `driver`
- `port`
- `status`
- `metadataJson`
- `lastHeartbeatAt`

### `device_health_logs`
- `id`
- `deviceCode`
- `level`
- `message`
- `createdAt`

## Consulta local de pagos completados
Se incluye expresamente.

### Requisito
Poder verificar localmente si un `QR UUID` ya fue cobrado en esa maquina.

### Endpoints sugeridos
- `GET /payments/completed`
- `GET /payments/completed/by-qr/:qrCode`

### Filtros sugeridos
- `qrCode`
- `ppeTransactionUuid`
- `serverPaymentId`
- `status=COMPLETED`
- `dateFrom`
- `dateTo`

### Respuesta minima para `by-qr`
- `exists`
- `qrCode`
- `ppeTransactionUuid`
- `serverPaymentId`
- `status`
- `targetAmount`
- `insertedAmount`
- `changeAmount`
- `completedAt`

## Decision importante
La API de pagos completados debe leer desde `payment_sessions` con indices por:
- `qrCode`
- `status`
- `completedAt`

Con esto la consulta no deberia cargar de mas la base local.
