# PPE Frontend — Guía completa

Interfaz de usuario del **Punto de Pago Electrónico** para parqueaderos. Aplicación React + TypeScript + Vite diseñada para una pantalla táctil de **1024 × 768 px**.

---

## Tecnologías

| Herramienta | Versión | Uso |
|---|---|---|
| React | 19 | UI |
| TypeScript | 5.8 | Tipado estático |
| Vite | 7 | Bundler / dev server |
| Tailwind CSS | 3.4 | Estilos utilitarios |
| EventSource (SSE) | nativo | Eventos en tiempo real del backend |

---

## Comandos

```bash
# Desarrollo con simulador (sin backend ni periféricos)
npm run dev:sim

# Desarrollo conectado al backend real
npm run dev

# Compilar para producción → genera dist/
npm run build

# Servir el build localmente para verificar
npm run preview
```

**En producción** el flujo es:
1. `npm run build` → genera la carpeta `dist/`
2. El backend NestJS o un servidor (nginx, caddy) sirve esa carpeta estática

---

## Estructura de archivos

```
frontend/
├── public/                      # Archivos estáticos servidos tal cual
│   ├── LogoCoins.png
│   ├── ImagenEscanear.jpeg      # Imagen idle de pago
│   ├── PARKING-PAYMENT-BG.png   # Fondo de los paneles
│   ├── background_login.png     # Fondo del body
│   └── esfera.png               # Favicon
│
├── src/
│   ├── App.tsx                  # Componente raíz — toda la lógica de estado
│   ├── main.tsx                 # Entry point de React
│   ├── styles.css               # Tailwind base + clases reutilizables
│   │
│   ├── components/
│   │   ├── KeyboardModal.tsx    # Teclado táctil (QWERTY / numérico)
│   │   └── SimPanel.tsx         # Panel de simulación (solo dev:sim)
│   │
│   ├── hooks/
│   │   └── useLogoUnlock.tsx    # Toca el logo 5 veces → accede al selector
│   │
│   └── lib/
│       ├── api.ts               # Llamadas reales al backend
│       ├── sim-api.ts           # Versión simulada de todas las APIs
│       ├── sim-events.ts        # Simulador de eventos SSE
│       └── types.ts             # Tipos compartidos
│
├── tailwind.config.ts           # Tokens de diseño (colores, sombras, radios)
├── index.html                   # HTML raíz (favicon, fuentes)
└── package.json
```

---

## Modos de la aplicación (rootMode)

El estado `rootMode` controla qué pantalla principal se muestra:

```
payment       → Pantalla de pago (flujo normal del cliente)
mode-select   → Selector de modo (oculto, se accede con el logo)
maintenance   → Pantalla de mantenimiento (sin cobros)
admin-login   → Login del panel administrativo
admin-dashboard → Panel administrativo completo
```

### Cómo navegar entre modos
- **Logo (5 toques en 3 s)** → abre el selector de modo
- **Selector** → elige entre "Pago", "Mantenimiento" o "Admin"
- **Sin conexión al backend** → va automáticamente a `maintenance`
- **EventSource sin respuesta 10 s** → va automáticamente a `maintenance`

---

## Flujo de pago (paymentStage)

```
idle → review → collecting → finalizing → (vuelve a idle en 30 s)
```

| Etapa | Qué muestra | Cómo avanza |
|---|---|---|
| `idle` | Imagen "Escanee su QR" | Backend envía evento `session.review-ready` |
| `review` | Datos del pago + botón Aceptar | Operador toca "Aceptar pago" (30 s o cancela) |
| `collecting` | Insertar billetes / monedas | Backend envía `session.completed` |
| `finalizing` | Pantalla de gracias + cambio | Auto-vuelve a idle en 30 s |

### Timer de revisión (30 s)
Si el operador no acepta el pago en 30 segundos, se cancela automáticamente la sesión en el backend y vuelve a `idle`.

### Pantalla de carga entre etapas
Si la transición de `review → collecting` tarda más de **700 ms**, aparece una pantalla de "Procesando... Por favor espere". Si es rápida, la transición es transparente.

---

## Eventos SSE (Server-Sent Events)

El frontend escucha `/api/kiosk/events` y reacciona a estos eventos:

| Evento | Acción |
|---|---|
| `session.review-ready` | Pasa a etapa `review` con los datos del pago |
| `session.collecting-enabled` | Pasa a etapa `collecting` |
| `cash.received` | Actualiza el monto insertado en `collecting` |
| `session.completed` | Pasa a etapa `finalizing` con el cambio calculado |
| `session.canceled` | Vuelve a `idle` |
| `session.timeout` | Vuelve a `idle` |
| `kiosk.mode.changed` | Cambia entre `payment` y `maintenance` |
| `collector.sample-received` | Actualiza muestras del test de colector (admin) |
| `machine.low-change-warning` | Actualiza política de aceptación de billetes |

### Comportamiento sin conexión
- Error en conexión inicial (`fetchKioskState`) → modo `maintenance`
- Error en EventSource → muestra "Reconectando..." y espera 10 s
- Si no se recupera en 10 s → modo `maintenance`
- Si se recupera → cancela el timer y restaura el mensaje normal

---

## Panel administrativo

### Acceso
1. Logo × 5 → selector de modo → "Acceso admin"
2. Login con correo y contraseña (JWT local del PPE)

### Vistas (adminView)

| Vista | Descripción |
|---|---|
| `home` | 4 botones de navegación |
| `cargar-dinero` | Gestión de slots del dispensador (carga / retiro / denominación) |
| `dispositivos` | Estado de hardware + test del colector |
| `pagos-completados` | Listado paginado (5 por página) de pagos del día |
| `cierres` | Ejecutar cierres parciales o totales + historial |

### Sesión admin
- El JWT se guarda en `localStorage` para sobrevivir recargas
- Al salir se limpia el token local y se vuelve al selector

---

## Teclado táctil (KeyboardModal)

Abre un modal con teclado al tocar cualquier campo de texto. Tipos disponibles:

| Tipo | Cuándo se usa | Layout |
|---|---|---|
| `email` | Correo del login | QWERTY + @ siempre visible + 123 |
| `password` | Contraseña del login | QWERTY con puntos en display |
| `text` | Motivo, notas de cierre | QWERTY + 123 / símbolos |
| `numeric` | Cantidad de billetes | Grid 3×4 estilo teléfono |

Los inputs son `readOnly` para evitar que el teclado nativo del sistema aparezca.

---

## Modo simulación (dev:sim)

Activo cuando `VITE_SIMULATE=true` (comando `npm run dev:sim`).

Reemplaza todas las llamadas al backend con versiones mock. Aparece un panel flotante en la esquina inferior derecha con controles para simular el flujo completo:

1. Elegir monto → "Simular scan de QR" → pasa a `review`
2. Operador toca "Aceptar pago" → pasa a `collecting`
3. Insertar billetes/monedas con los botones del panel → al completar pasa a `finalizing`

**El SimPanel no aparece en producción** (`npm run build` excluye el código por la variable de entorno).

---

## Sistema de diseño

### Colores (tailwind.config.ts)

| Token | Valor | Uso |
|---|---|---|
| `brand-500` | `#2196F3` | Botones primarios, énfasis |
| `brand-700` | `#0D47A1` | Hover primario |
| `ok-500` | `#4CAF50` | Estados exitosos |
| `alert-500` | `#F44336` | Errores / alertas |
| `ink` | `#1a1a2e` | Texto principal |
| `muted` | `#6B7280` | Texto secundario |
| `orange` | `#FF8533` | Icono de mantenimiento |

### Clases reutilizables (styles.css)

| Clase | Descripción |
|---|---|
| `glass-panel` | Panel con fondo PARKING-PAYMENT-BG + blur. Scroll interno |
| `glass-panel-fill` | Igual pero ocupa todo el alto disponible (flex-col) |
| `touch-button` | Base de botón táctil (min 3rem de alto) |
| `touch-button-primary` | Botón azul principal |
| `touch-button-secondary` | Botón borde azul, fondo blanco |
| `touch-input` | Input táctil (readOnly + cursor-pointer) |
| `metric-box` | Caja de métrica con borde sutil |
| `screen-shell` | Sección full-screen con padding |
| `screen-center` | Igual pero centra el contenido verticalmente |

### Fondos
- **Body**: `background_login.png` con fallback `#1a2a4a`
- **Paneles**: `PARKING-PAYMENT-BG.png` con overlay oscuro 8% + blur. Fallback `rgba(255,255,255,0.82)`

---

## Variables de entorno

| Variable | Valor | Efecto |
|---|---|---|
| `VITE_SIMULATE` | `true` | Activa modo simulación |

Definidas en `src/vite-env.d.ts` para tipado TypeScript.

---

## Notas de producción

- Los inputs del teclado táctil son `readOnly` — el teclado nativo del OS no debe aparecer
- El SimPanel **nunca se muestra** en producción (condición `{SIMULATE && ...}`)
- Si el backend no responde al arrancar, el kiosko va directo a mantenimiento
- El logo en la esquina superior izquierda requiere **5 toques en menos de 3 segundos** para abrir el selector oculto
