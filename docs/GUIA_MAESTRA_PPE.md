# Guia Maestra PPE

## 1. Alcance

Este documento resume el estado funcional del proyecto `PPE`, como instalarlo, como arrancarlo, como reconstruir su base de datos, como funciona el flujo de pago en efectivo, como se integra con `nexo_back`, y donde estan los documentos tecnicos de detalle.

Este proyecto hoy cubre:

- lectura de QR y validacion contra servidor
- cobro fisico en efectivo
- control de inventario de efectivo recibido y cambio disponible
- cargue, descargue y expulsion manual por slot
- cierres parciales y totales
- impresion de recibos y cierres
- backup diario local de la base SQLite
- advertencias en pantalla segun cambio disponible

## 2. Repositorios involucrados

En este workspace hay varios proyectos, pero para el flujo del kiosko los principales son:

- `PPE`: backend local del kiosko y frontend React del PPE
- `nexo_back`: servidor principal con MySQL y reglas de negocio centrales
- `punto_registro`: punto de registro
- `api-uniminuto`: integracion o piezas externas segun despliegue

## 3. Confirmacion de zonas horarias

### 3.1 `nexo_back` usa UTC en la conexion a DB

Esto esta confirmado en codigo:

- [nexo_back/src/app.module.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\nexo_back\src\app.module.ts:35)
- [nexo_back/src/config/typeorm.config.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\nexo_back\src\config\typeorm.config.ts:16)

En ambos archivos la conexion TypeORM de MySQL declara:

- `timezone: 'Z'`

Eso significa que la capa ORM del servidor trabaja en UTC.

### 3.2 `PPE` muestra hora Colombia al operador

Regla vigente del proyecto:

- almacenamiento e integracion: UTC / ISO
- frontend del PPE: hora Colombia `America/Bogota`
- recibos impresos: hora Colombia `America/Bogota`

Esto se resuelve en:

- frontend:
  - [frontend/src/App.tsx](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\frontend\src\App.tsx:43)
  - [frontend/src/lib/api.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\frontend\src\lib\api.ts:1)
- impresion:
  - [src/modules/printing/application/printing.service.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\printing\application\printing.service.ts:23)

Consecuencia practica:

- en pantalla y tirillas el operador ve hora local de Colombia, UTC-5
- hacia `nexo_back` y en payloads ISO se conserva UTC

## 4. Arquitectura funcional resumida

### 4.1 `PPE` backend

El backend local del PPE esta construido en NestJS y se divide por modulos:

- `payment-core`: sesiones de pago, QR, efectivo, commit, cambio
- `cash-management`: inventario, movimientos, dashboard, cierres
- `peripherals`: placa electronica, billetero, QR, slots, deteccion de hardware
- `kiosk`: estado del kiosko y eventos SSE
- `printing`: recibos y tirillas
- `server-link`: integracion con `nexo_back`
- `local-api`: endpoints administrativos del kiosko
- `persistence`: SQLite local, entidades y migraciones

Documento relacionado:

- [ARQUITECTURA_PPE.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\docs\ARQUITECTURA_PPE.md)
- [ENDPOINTS_Y_EVENTOS_PPE.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\docs\ENDPOINTS_Y_EVENTOS_PPE.md)

### 4.2 Frontend del PPE

El frontend esta en React + Vite:

- pantalla de pago
- pantalla de mantenimiento
- dashboard administrativo
- manejo de slots de cambio
- cierres
- estado de dispositivos

Canales de comunicacion usados por el frontend:

- `HTTP/JSON` hacia `/api/...`
- `SSE` por `GET /api/kiosk/events`

No usa:

- acceso directo a SQLite
- `WebSocket`
- `Socket.IO`

### 4.3 `nexo_back`

`nexo_back` es el servidor principal del negocio:

- valida QR / deuda
- confirma pagos
- mantiene MySQL en UTC
- centraliza logica global de parqueadero y pagos

## 5. Estructura de carpetas

Arbol simplificado del `PPE`:

```text
PPE/
├── config_files/
├── data/
│   ├── backup/
│   ├── migrations/
│   └── ppe.sqlite
├── docs/
├── frontend/
│   └── src/
├── scripts/
│   ├── diag-cash-hardware.js
│   └── migrate.ts
├── src/
│   ├── common/
│   └── modules/
├── vendor/
└── package.json
```

Subcarpetas importantes:

- `data/ppe.sqlite`: base local del PPE
- `data/backup/`: backup diario unico de la base
- `vendor/`: librerias legacy de hardware
- `scripts/diag-cash-hardware.js`: diagnostico de hardware de efectivo
- `scripts/migrate.ts`: runner custom de migraciones

## 6. Instalacion

### 6.1 Requisitos

- Node.js 24.x
- npm
- `nexo_back` disponible si se quiere validar flujo real extremo a extremo
- Sistema operativo: Windows 10/11 o Ubuntu 22.04+

### 6.2 Permisos de hardware por sistema operativo

El PPE se comunica con la placa electronica y el lector QR a traves de puertos seriales USB. El acceso a esos puertos depende del sistema operativo.

#### Windows

En Windows los dispositivos aparecen como puertos COM virtuales (COM3, COM4, etc.). Node.js puede abrirlos sin configuracion adicional si el usuario tiene permisos normales de escritorio.

Los identificadores USB fijos del hardware son:

| Dispositivo | VID | PID | Puerto tipico |
|---|---|---|---|
| Lector QR | 26F1 | 5650 | COM4 |
| Placa electronica | 067B | 2303 | COM3 |

El PPE detecta automaticamente el puerto correcto por VID/PID aunque cambie el numero COM. Si la deteccion automatica falla, se puede forzar el puerto con `QR_SCANNER_PORT` o `ELECTRONIC_BOARD_PORT` en el `.env`.

#### Linux (Ubuntu)

En Linux los dispositivos aparecen como `/dev/ttyACM*` o `/dev/ttyUSB*`. Por defecto solo el grupo `dialout` tiene permiso de lectura/escritura sobre esos dispositivos.

| Dispositivo | VID | PID | Puerto tipico en Linux |
|---|---|---|---|
| Lector QR | 26F1 | 5650 | /dev/ttyACM0 |
| Placa electronica | 067B | 2303 | /dev/ttyUSB0 |

Para dar acceso permanente al usuario que ejecuta el PPE, correr una sola vez:

```bash
sudo usermod -aG dialout <usuario>
```

Ejemplo con el usuario `servercoins`:

```bash
sudo usermod -aG dialout servercoins
```

Despues de ese comando hay que **cerrar sesion y volver a entrar** (o reiniciar el equipo) para que el grupo sea efectivo.

Si se necesita acceso inmediato sin reiniciar sesion (temporal, se pierde al desconectar los dispositivos):

```bash
sudo chmod a+rw /dev/ttyACM0 /dev/ttyUSB0
```

Para verificar que el usuario ya tiene el grupo correcto:

```bash
groups $USER
# debe incluir: dialout
```

Para verificar que los dispositivos estan conectados y con los VID/PID esperados:

```bash
lsusb | grep -E "26f1|067b"
# debe mostrar las dos lineas de lector QR y placa electronica
```

### 6.3 Variables de entorno del PPE

Archivo base:

- [.env.example](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\.env.example:1)

Variables mas importantes:

- `DATABASE_PATH=./data/ppe.sqlite`
- `PRINTER_JAVA_SERVER_URL=http://localhost:8080/imprimir`
- `PRINTER_NAME=printer`
- `SERVER_LINK_URL`
- `PPE_DEVICE_UUID`
- `PPE_DEVICE_SECRET`
- `LOCAL_API_ADMIN_KEY`
- `PPE_JWT_SECRET`
- `ELECTRONIC_BOARD_USB_VID` / `ELECTRONIC_BOARD_USB_PID` (deteccion automatica por VID/PID, recomendado)
- `QR_SCANNER_USB_VID` / `QR_SCANNER_USB_PID` (deteccion automatica por VID/PID, recomendado)
- `ELECTRONIC_BOARD_PORT` (fallback si la deteccion automatica no funciona)
- `QR_SCANNER_PORT` (fallback si la deteccion automatica no funciona)
- `BILL_VALIDATOR_USB_VID` / `BILL_VALIDATOR_USB_PID`
- `BILL_VALIDATOR_PORT`

## 7. Arranque del proyecto

### 7.1 Backend PPE

Desde `PPE/`:

```bash
npm install
npm run migrate
npm run start
```

Comandos utiles:

- `npm run build:back`
- `npm run build:front`
- `npm run build`
- `npm run start`
- `npm run start:dev`
- `npm run start:prod`
- `npm run test -- --runInBand`
- `npm run diag:cash`

### 7.2 Frontend PPE

El frontend tambien puede ejecutarse aislado desde `PPE/frontend/`, pero el modo recomendado del proyecto ya es monolitico desde la raiz de `PPE`.

### 7.3 Comandos confirmados

En `PPE/package.json` quedaron vigentes:

- `npm run build`
- `npm run migrate`
- `npm run seed`

Nota importante:

- `npm run seed` en este proyecto no ejecuta un seeder independiente
- hoy es un alias de `migration:run`
- la semilla operativa esta embebida en migraciones idempotentes

## 8. Base de datos local del PPE

### 8.1 Ruta unica

La base del PPE usa una sola ruta obligatoria:

- [src/common/config/database-path.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\common\config\database-path.ts:1)

La ruta la define:

- `DATABASE_PATH`

Hoy el valor esperado es:

- `./data/ppe.sqlite`

### 8.2 Como reconstruir la DB desde cero

Para recrear la base limpia:

1. apagar backend PPE, frontend PPE y cualquier visor como DBeaver
2. borrar `data/ppe.sqlite`
3. borrar `data/migrations/applied.json`
4. correr:

```bash
npm run migrate
```

Resultado esperado:

- la DB se crea sola en `data/ppe.sqlite`
- se aplican migraciones
- queda sembrado el baseline minimo

### 8.3 Baseline operativo que debe existir

La reconstruccion desde cero deja, como minimo:

- `denominations`
- `cash_inventory`
- `devices`
- `dispenser_slots`
- `kiosk_state`
- tablas de `payment_sessions`, `payment_lines`, `payment_session_events`
- tablas de `cash_movements`, `cash_closeouts`, `cash_closeout_lines`

Migraciones clave:

- [1760000000000-InitialPpeSchema.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\persistence\infrastructure\migrations\1760000000000-InitialPpeSchema.ts)
- [1760000001000-SeedBaselineCatalogs.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\persistence\infrastructure\migrations\1760000001000-SeedBaselineCatalogs.ts)
- [1760000004000-CreateDispenserSlots.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\persistence\infrastructure\migrations\1760000004000-CreateDispenserSlots.ts)
- [1760000010000-CreateKioskState.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\persistence\infrastructure\migrations\1760000010000-CreateKioskState.ts)
- [1760000014000-EnsureBaselineOperationalData.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\persistence\infrastructure\migrations\1760000014000-EnsureBaselineOperationalData.ts)

## 9. Backup diario de la DB local

Servicio responsable:

- [src/common/services/database-backup.service.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\common\services\database-backup.service.ts:1)

Comportamiento actual:

- crea backup al iniciar el backend
- agenda el siguiente a medianoche
- guarda el backup en `data/backup`
- mantiene una sola copia vigente
- cuando crea la nueva, elimina la anterior

## 10. Flujo funcional del pago PPE

Flujo esperado:

1. el usuario escanea QR
2. el PPE consulta `nexo_back`
3. si el QR es valido se muestra el valor a pagar
4. antes de cobrar se muestran advertencias:
   - no recibe monedas nuevas de $200
   - no recibe billetes de $100.000
   - pago exacto / cambio limitado segun `dispenser_slots`
5. se habilita recepcion de efectivo
6. cada billete/moneda aceptado se registra en `cash_inventory`
7. al cubrir el monto se desactiva recepcion
8. si hay cambio, se calcula desde `dispenser_slots`
9. se ordena la devolucion fisica por slot
10. se descuenta inventario del slot
11. se confirma el pago con `nexo_back`
12. se ofrece impresion de comprobante

Modulo principal:

- [src/modules/payment-core/application/payment-session.service.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\payment-core\application\payment-session.service.ts)

## 11. Inventarios y tablas clave

### 11.1 `cash_inventory`

Representa el efectivo recibido por los receptores.

Uso:

- recaudo
- cierres
- movimientos historicos

### 11.2 `dispenser_slots`

Representa los slots fisicos de cambio disponibles para devolver dinero.

Uso:

- definir denominacion por slot
- definir cantidad fisica cargada por slot
- calcular si se puede aceptar o no un billete alto
- calcular y ejecutar devuelta
- cargar, descargar, expulsar manualmente

### 11.3 Regla de negocio

- `cash_inventory` no reemplaza `dispenser_slots`
- el cambio siempre se calcula desde `dispenser_slots`
- el efectivo recibido siempre incrementa `cash_inventory`

## 12. Hardware y placa electronica

Documentos relacionados:

- [FUNCIONAMIENTO_HARDWARE_EFECTIVO.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\docs\FUNCIONAMIENTO_HARDWARE_EFECTIVO.md)
- [TRAMAS_DEVOLUCION_PLACA.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\docs\TRAMAS_DEVOLUCION_PLACA.md)

### 12.1 Componentes principales

- billetero
- receptor de monedas
- placa electronica
- hopper/monederos de cambio
- billeteros de devolucion
- lector QR
- impresora

### 12.2 Librerias legacy

Adaptadores usados:

- [bill-validator.adapter.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\peripherals\infrastructure\adapters\bill-validator.adapter.ts)
- [electronic-board.adapter.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\peripherals\infrastructure\adapters\electronic-board.adapter.ts)
- [qr-scanner.adapter.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\peripherals\infrastructure\adapters\qr-scanner.adapter.ts)

### 12.3 Hallazgos relevantes del hardware

- monedas nuevas de $200 no estan soportadas en campo actualmente
- billetes de $100.000 no deben anunciarse como aceptados
- la placa no confirma fisicamente la expulsion, solo responde ACK
- la logica de negocio no debe depender del calculo interno de la placa

## 13. Devolucion de efectivo

Servicio responsable:

- [src/modules/peripherals/application/peripherals.service.ts](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\src\modules\peripherals\application\peripherals.service.ts)

Regla vigente:

- el backend calcula la devuelta
- el backend decide cuantas unidades sacar por slot
- la placa solo recibe la orden fisica de expulsar

Limites contemplados:

- `bill1`: maximo 9 billetes por orden
- `bill2`: maximo 9 billetes por orden
- `coin1`: despacho por tandas
- `coin2`: despacho por tandas

Si la cantidad supera el maximo por frame:

- el backend parte la devolucion en varios chunks

## 14. Endpoints administrativos importantes

Documento de detalle:

- [ENDPOINTS_Y_EVENTOS_PPE.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\docs\ENDPOINTS_Y_EVENTOS_PPE.md)

### Slots

- `GET /api/dispensers/slots`
- `PATCH /api/dispensers/slots/:key`
- `POST /api/dispensers/slots/:key/load`
- `POST /api/dispensers/slots/:key/unload`
- `POST /api/dispensers/eject`

### Caja

- `GET /api/cash/inventory`
- `GET /api/cash/movements`
- `GET /api/cash/dashboard`
- `GET /api/cash/closeouts`
- `POST /api/cash/closeouts`

### Kiosko

- `GET /api/kiosk/state`
- `GET /api/kiosk/active-session`
- `POST /api/kiosk/mode`
- `POST /api/kiosk/payment-sessions/:id/collect`
- `POST /api/kiosk/payment-sessions/:id/cancel`
- `POST /api/kiosk/payment-sessions/:id/print-receipt`
- `GET /api/kiosk/events`

## 15. Scripts utiles

Desde `PPE/`:

- `npm run migrate`
- `npm run migration:status`
- `npm run migration:revert`
- `npm run diag:cash`

Scripts actuales en `scripts/`:

- `migrate.ts`
- `diag-cash-hardware.js`

## 16. Estado actual del desarrollo

Hoy ya esta implementado:

- DB unica por `DATABASE_PATH`
- migraciones y baseline operativo idempotente
- backup diario local
- advertencias de pago exacto / cambio limitado
- slots individuales con cargar, retirar y expulsar
- cierres parciales y totales
- devolucion por tramas fisicas confirmadas
- frontend y recibos en hora Colombia
- `nexo_back` confirmado en UTC

Pendiente de validacion final:

- pruebas integrales con hardware arriba
- verificacion fisica completa de todos los casos de devolucion
- afinado final de impresion si cambia el servicio Java de impresora

## 17. Referencias cruzadas

- [README.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\README.md)
- [ARQUITECTURA_PPE.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\docs\ARQUITECTURA_PPE.md)
- [FUNCIONAMIENTO_HARDWARE_EFECTIVO.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\docs\FUNCIONAMIENTO_HARDWARE_EFECTIVO.md)
- [TRAMAS_DEVOLUCION_PLACA.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\PPE\docs\TRAMAS_DEVOLUCION_PLACA.md)
- [nexo_back/docs/ARQUITECTURA.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\nexo_back\docs\ARQUITECTURA.md)
- [nexo_back/docs/GUIA_INSTALACION.md](C:\Users\mateo\OneDrive\Escritorio\proyecto de uniminuto\nexo_back\docs\GUIA_INSTALACION.md)
