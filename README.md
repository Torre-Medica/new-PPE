# PPE — Punto de Pago Electrónico

Sistema completo de cobro desatendido en efectivo para parqueaderos. Corre en una máquina dedicada (kiosko con pantalla táctil), recibe billetes y monedas, devuelve cambio, audita localmente y sincroniza con el servidor central `nexo_back`.

Está compuesto por:
- **Backend NestJS** (este proyecto, corre en el puerto 3100)
- **Frontend React + TypeScript + Vite** (carpeta `frontend/`, pantalla táctil 1024×768)

---

## Instalación y arranque

Guía completa desde cero: clonar, instalar, configurar la base de datos y arrancar.

### 1. Requisitos

- `Node.js 24 LTS`
- `npm`

### 2. Instalar dependencias

```bash
npm install
```

Esto instala tanto las dependencias del backend como las del `frontend` (ver `postinstall` / scripts de `build`).

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Revisa al menos `DATABASE_PATH` (ruta del archivo SQLite) y las llaves de la API local (`LOCAL_API_ADMIN_KEY`, etc.). Ver detalle completo en [Variables de entorno](#variables-de-entorno).

### 4. Generar la base de datos (migraciones + seed)

El seed de catálogos base (denominaciones, datos operativos iniciales) está integrado como una migración más — **no hace falta correr un comando de seed aparte**, basta con las migraciones:

```bash
npm run migration:run
```

Esto crea automáticamente el directorio y el archivo SQLite en la ruta indicada por `DATABASE_PATH` (si no existen) y aplica en orden todas las migraciones pendientes.

Verificar qué quedó aplicado:

```bash
npm run migration:status
```

Si necesitas partir de una base completamente limpia (⚠️ destructivo, no usar en producción sin respaldo):

```bash
rm -f data/ppe.sqlite data/ppe.sqlite-shm data/ppe.sqlite-wal data/migrations/applied.json
npm run migration:run
```

### 5. Arrancar el proyecto

```bash
npm run start
```

Arranca backend (NestJS, puerto 3100) y frontend (Vite, con hot-reload) juntos. Ver más variantes de arranque abajo.

### 6. Verificar que quedó arriba

```bash
curl http://localhost:3100/api/health/live
```

---

## Cómo arrancar el proyecto

### Desarrollo (backend + frontend juntos, con hot-reload)

```bash
npm install
npm run start
```

### Producción

```bash
# 1. Compilar todo
npm run build

# 2. Arrancar
npm run start:prod
```

### Simulación (solo frontend, sin backend ni hardware)

```bash
cd frontend
npm run dev:sim
```

Aparece un panel flotante para simular el flujo completo de pago sin periféricos.

### Resumen de todos los comandos

| Comando | Qué hace |
|---|---|
| `npm run start` | Backend dev (watch) + Frontend dev |
| `npm run start:prod` | Backend compilado + Frontend estático |
| `npm run start:backend` | Solo backend en modo desarrollo |
| `npm run start:frontend` | Solo frontend Vite dev |
| `npm run build` | Compila backend + frontend para producción |
| `npm run build:back` | Solo compila el backend |
| `npm run build:front` | Solo compila el frontend |
| `npm run migrate` | Aplica migraciones de base de datos |
| `npm run migration:generate` | Genera migración desde cambios en entidades |
| `npm run migration:revert` | Revierte la última migración |
| `npm test -- --runInBand` | Tests unitarios (--runInBand obligatorio) |
| `cd frontend && npm run dev:sim` | Frontend simulado sin backend |

---

## Frontend

Interfaz táctil del kiosko. Documentación completa en [`frontend/FRONTEND.md`](frontend/FRONTEND.md).

### Arquitectura visual

```
┌─────────────────────────────────────────────────┐
│                  MÁQUINA PPE                    │
│                                                  │
│  ┌─────────────────┐   ┌─────────────────────┐  │
│  │  Backend NestJS  │   │  Frontend React     │  │
│  │  Puerto 3100     │◄──│  Puerto 5173 (dev)  │  │
│  │                  │   │  o dist/ (prod)     │  │
│  └────────┬─────────┘   └─────────────────────┘  │
│           │ SQLite (./data/ppe.sqlite)            │
│    Periféricos físicos:                          │
│    - Validador de billetes (puerto serial)       │
│    - Dispensador de cambio (NV11/similar)        │
│    - Lector QR (USB serial)                      │
│    - Impresora térmica (servidor Java :8080)     │
└───────────┬─────────────────────────────────────┘
            │ Socket.io
            ▼
    ┌───────────────┐
    │   nexo_back   │
    │   Puerto 3009  │
    └───────────────┘
```

### Flujo de pago (pantalla)

```
idle → review → collecting → finalizing → (vuelve a idle en 30 s)
```

| Etapa | Qué muestra |
|---|---|
| `idle` | "Escanee su QR" |
| `review` | Datos del cobro + botón Aceptar (30 s o cancela) |
| `collecting` | Insertar billetes/monedas + monto acumulado |
| `finalizing` | "¡Gracias por su pago!" + cambio devuelto |

### Panel administrativo (frontend)

Acceso: tocar el logo **5 veces en menos de 3 segundos** → selector → "Acceso admin" → login.

| Vista | Función |
|---|---|
| Cargar dinero | Gestión de slots del dispensador |
| Dispositivos | Estado del hardware + test del colector |
| Pagos completados | Listado paginado de cobros del día |
| Cierres | Cierres parciales o totales de caja |

---

## Backend

## Objetivo

Este proyecto corre en una maquina distinta al servidor principal y se encarga de:

- identificar un cobro por `QR` o placa
- abrir una sesion local de pago
- recibir efectivo
- calcular y devolver cambio
- guardar auditoria completa en base local
- sincronizar el resultado con `nexo_back`
- exponer una API local para operacion, soporte y monitoreo

## Stack tecnico

- `Node.js 24 LTS`
- `NestJS`
- `TypeScript`
- `TypeORM`
- `better-sqlite3`
- `socket.io-client`

## Estado actual

El backend ya tiene implementado:

- persistencia local con `SQLite`
- inventario por denominacion
- sesiones de pago
- eventos de auditoria
- intentos de sincronizacion con servidor
- modulo de perifericos con base legacy
- API local protegida por `x-api-key`
- pruebas unitarias y e2e

## Conexion a la base de datos

### Archivos donde quedo la conexion

La configuracion de base quedo repartida asi:

- [src/common/config/app.config.ts](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/common/config/app.config.ts>)
  Expone la configuracion `database.path` y `database.logging`.
- [src/common/config/database-path.ts](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/common/config/database-path.ts>)
  Resuelve la ruta final de la `SQLite`.
- [src/modules/persistence/infrastructure/typeorm.config.ts](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/persistence/infrastructure/typeorm.config.ts>)
  Configuracion TypeORM usada por la aplicacion Nest en runtime.
- [src/modules/persistence/infrastructure/data-source.ts](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/persistence/infrastructure/data-source.ts>)
  `DataSource` usado por comandos TypeORM y migraciones.

### Tipo de base

La base local del `PPE` es `SQLite`, no `MySQL` ni `PostgreSQL`.

Eso significa que:

- no existe `host`
- no existe `port`
- no existe `username`
- no existe `password`

La “credencial” real es el archivo `.sqlite` al que apunta `DATABASE_PATH`.

### Ruta activa hoy

En el entorno actual el proyecto usa:

```env
DATABASE_PATH=./data/ppe.sqlite
```

Entonces la base activa queda en:

- [data/ppe.sqlite](</C:/Users/mateo/OneDrive/Escritorio/PPE/data/ppe.sqlite>)

### Variables relacionadas con base

Hoy quedaron asi en [.env](</C:/Users/mateo/OneDrive/Escritorio/PPE/.env>):

```env
DATABASE_PATH=./data/ppe.sqlite
TYPEORM_LOGGING=false
```

### Como se resuelve la ruta

La logica es:

1. si existe `DATABASE_PATH`, se usa esa ruta
2. si no existe y hay `LOCALAPPDATA`, usa `%LOCALAPPDATA%\PPE\ppe.sqlite`
3. si nada de eso existe, usa `./ppe.sqlite`

## Variables de entorno

Archivo actual:

- [.env](</C:/Users/mateo/OneDrive/Escritorio/PPE/.env>)

Plantilla:

- [.env.example](</C:/Users/mateo/OneDrive/Escritorio/PPE/.env.example>)

Variables disponibles:

```env
NODE_ENV=development
PORT=3000
API_PREFIX=api
DATABASE_PATH=./data/ppe.sqlite
TYPEORM_LOGGING=false
SERVER_LINK_URL=http://localhost:3001
SERVER_LINK_NAMESPACE=/
PPE_DEVICE_UUID=ppe-local-dev
PPE_DEVICE_SECRET=ppe-local-dev-secret
LOCAL_API_ADMIN_KEY=ppe-admin-local
LOCAL_API_OPERATOR_KEY=ppe-operator-local
LOCAL_API_AUDIT_KEY=ppe-audit-local
```

## Credenciales actuales

### Base de datos

No hay usuario ni password porque la base es `SQLite`.

### API local

La API local si usa llaves por rol:

- `admin`: `ppe-admin-local`
- `operator`: `ppe-operator-local`
- `audit`: `ppe-audit-local`

Estas llaves viajan en la cabecera:

```http
x-api-key: ppe-audit-local
```

### Enlace con servidor principal

El `PPE` tambien tiene identidad propia para el socket:

- `PPE_DEVICE_UUID=ppe-local-dev`
- `PPE_DEVICE_SECRET=ppe-local-dev-secret`

Estas no son credenciales de base de datos; son credenciales de integracion con `nexo_back`.

## Arquitectura del sistema

### Flujo general

1. el usuario escanea `QR` o se identifica por placa
2. el `PPE` crea una `payment session`
3. el `PPE` intenta validar el cobro con `nexo_back`
4. se habilita recepcion de efectivo
5. se registra cada billete/moneda recibida
6. si hay sobrante, se calcula cambio
7. se ordena la devolucion
8. se registra el resultado localmente
9. se intenta confirmar el pago al servidor principal
10. la salida real solo debe habilitarse cuando el servidor confirme

### Modulos principales

#### `persistence`

Responsable de:

- entidades TypeORM
- configuracion SQLite
- migraciones

Ruta:

- [src/modules/persistence](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/persistence>)

#### `cash-management`

Responsable de:

- inventario por denominacion
- cargas de efectivo
- descargas de efectivo
- registro de dinero recibido
- registro de dinero dispensado
- calculo de cambio

Ruta:

- [src/modules/cash-management](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/cash-management>)

#### `payment-core`

Responsable de:

- iniciar sesiones
- registrar efectivo
- completar cobros
- cancelar sesiones
- reintentar sincronizacion
- consulta de pagos completados

Ruta:

- [src/modules/payment-core](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/payment-core>)

#### `peripherals`

Responsable de:

- conectar hardware
- escuchar eventos de dinero
- disparar devolucion de cambio
- guardar estado de dispositivos

Ruta:

- [src/modules/peripherals](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/peripherals>)

#### `server-link`

Responsable de:

- cliente `socket.io`
- validacion contra `nexo_back`
- commit del pago
- cancelacion
- firma de mensajes

Ruta:

- [src/modules/server-link](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/server-link>)

#### `audit`

Responsable de:

- eventos de sesion
- salud de dispositivos
- intentos de sincronizacion

Ruta:

- [src/modules/audit](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/audit>)

#### `local-api`

Responsable de:

- exponer salud
- servir la API local del equipo

Ruta:

- [src/modules/local-api](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/local-api>)

## Modelo de datos local

Tablas principales:

- `denominations`
- `cash_inventory`
- `cash_movements`
- `payment_sessions`
- `payment_lines`
- `payment_session_events`
- `server_sync_attempts`
- `devices`
- `device_health_logs`

### Regla importante de denominaciones

El `PPE` no admite billetes de `100000 COP`.

Por eso:

- ya no se siembra como denominacion nueva
- en bases existentes se marca como inactiva
- no aparece en el inventario operativo expuesto por la API

Denominaciones activas actuales:

- `50`
- `100`
- `200`
- `500`
- `1000`
- `2000`
- `5000`
- `10000`
- `20000`
- `50000`

## Seguridad local

La API usa un guard global:

- [src/common/security/local-api-auth.guard.ts](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/common/security/local-api-auth.guard.ts>)

Comportamiento:

- `/api/health/live` y `/api/health/ready` son publicos
- el resto exige `x-api-key`
- cada endpoint define roles con `@Roles(...)`

Roles:

- `admin`
- `operator`
- `audit`

## API local

Prefijo actual:

```text
/api
```

### Salud

- `GET /api/health/live`
- `GET /api/health/ready`

### Inventario

- `GET /api/cash/inventory`
- `GET /api/cash/movements`
- `POST /api/cash/load`
- `POST /api/cash/unload`

### Pagos

- `POST /api/payments/start`
- `POST /api/payments/:id/cash`
- `POST /api/payments/:id/complete`
- `POST /api/payments/cancel/:id`
- `POST /api/payments/sync/retry`
- `GET /api/payments/:id`
- `GET /api/payments/:id/events`
- `GET /api/payments/completed/search`
- `GET /api/payments/completed/by-qr/:qrCode`

### Dispositivos

- `GET /api/devices`
- `POST /api/devices/connect`
- `POST /api/devices/connect-all`
- `POST /api/devices/disconnect-all`

### Auditoria

- `GET /api/audit/payment-events`
- `GET /api/audit/device-health`
- `GET /api/audit/server-sync-attempts`

### Enlace servidor

- `GET /api/server-link/status`

## Ejemplos de uso

### Consultar salud

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health/live
```

### Consultar inventario

```powershell
Invoke-RestMethod `
  -Headers @{ 'x-api-key' = 'ppe-audit-local' } `
  -Uri http://localhost:3000/api/cash/inventory
```

### Iniciar sesion de pago

```powershell
$headers = @{ 'x-api-key' = 'ppe-operator-local' }
$body = '{"targetAmount":3000,"qrCode":"qr-demo-001","concept":"Pago de prueba"}'

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/payments/start `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

### Registrar efectivo

```powershell
$headers = @{ 'x-api-key' = 'ppe-operator-local' }
$body = '{"denominationId":2000,"quantity":2,"createdBy":"operator"}'

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/payments/<session-id>/cash `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

### Completar pago

```powershell
$headers = @{ 'x-api-key' = 'ppe-operator-local' }
$body = '{"committedBy":"operator"}'

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/payments/<session-id>/complete `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

## Migraciones

Comandos:

```bash
npm run migration:run
npm run migration:revert
```

Las migraciones viven en:

- [src/modules/persistence/infrastructure/migrations](</C:/Users/mateo/OneDrive/Escritorio/PPE/src/modules/persistence/infrastructure/migrations>)

## Pruebas

Comandos disponibles:

```bash
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Cobertura actual validada:

- guard local de autenticacion
- confirmacion de pago exacto
- reintento de sincronizacion sin redispensar cambio
- endpoints base de salud y proteccion de API

## Arranque local (solo backend)

1. instalar dependencias

```bash
npm install
```

2. revisar `.env`

3. correr migraciones

```bash
npm run migrate
```

4. arrancar solo el backend (dev)

```bash
npm run start:backend
```

5. verificar salud

```bash
curl http://localhost:3100/api/health/live
```

> Para arrancar backend + frontend juntos usa `npm run start` desde la raíz (ver sección "Cómo arrancar el proyecto" al inicio).

## Estado de integracion con `nexo_back`

Hoy el `server-link` ya existe, pero si `nexo_back` no esta disponible en `SERVER_LINK_URL`, el sistema cae en `fallback` local.

Eso produce:

- validacion local aceptada
- commit local con `paymentRegistered=false`
- sesiones `COMPLETED_WITH_WARNING`
- `serverSyncStatus=REJECTED`

Mientras no se conecte el socket real del servidor, eso es el comportamiento esperado.

## Documentacion adicional

- [`frontend/FRONTEND.md`](frontend/FRONTEND.md) — Guía completa del frontend (componentes, SSE, teclado táctil, simulación, diseño)
- [`docs/ARQUITECTURA_PPE.md`](docs/ARQUITECTURA_PPE.md) — Diseño interno del backend
- [`docs/ENDPOINTS_Y_EVENTOS_PPE.md`](docs/ENDPOINTS_Y_EVENTOS_PPE.md) — API REST y eventos SSE completos
- [`docs/FUNCIONAMIENTO_HARDWARE_EFECTIVO.md`](docs/FUNCIONAMIENTO_HARDWARE_EFECTIVO.md) — Protocolo con el hardware
- [`docs/GUIA_MAESTRA_PPE.md`](docs/GUIA_MAESTRA_PPE.md) — Guía de operación del kiosko
- [`docs/README.md`](docs/README.md)
- [`docs/ACUERDOS.md`](docs/ACUERDOS.md)
- [`docs/PLAN_TRABAJO.md`](docs/PLAN_TRABAJO.md)
- [`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md)
- [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md)

## Observaciones operativas

- la base local actual esta dentro del proyecto para facilitar desarrollo
- en produccion puede moverse a otra ruta con `DATABASE_PATH`
- las llaves actuales son de desarrollo y deben cambiarse en despliegue real
- el hardware legacy todavia depende de adaptadores basados en el proyecto viejo
- la salida del parqueadero no debe depender solo del `PPE`; debe depender de confirmacion del servidor principal
