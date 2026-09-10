# Funcionamiento de hardware de efectivo PPE

Este documento resume como estamos hablando hoy con la placa electronica, el billetero y los receptores de efectivo usando las librerias vendor ya incluidas en el proyecto.

## Comando de diagnostico

Ejecutar desde [package.json](c:/Users/mateo/OneDrive/Escritorio/proyecto%20de%20uniminuto/PPE/package.json):

```bash
npm run diag:cash
```

Variantes utiles:

```bash
npm run diag:cash -- --bills-only
npm run diag:cash -- --board-only
npm run diag:cash -- --accept=1000,2000,5000
```

Script usado: [scripts/diag-cash-hardware.js](c:/Users/mateo/OneDrive/Escritorio/proyecto%20de%20uniminuto/PPE/scripts/diag-cash-hardware.js)

## Variables de entorno relevantes

Archivo: [.env](c:/Users/mateo/OneDrive/Escritorio/proyecto%20de%20uniminuto/PPE/.env)

- `BILL_VALIDATOR_PORT`: COM fijo del billetero si no se resuelve por USB.
- `BILL_VALIDATOR_USB_VID`
- `BILL_VALIDATOR_USB_PID`
- `ELECTRONIC_BOARD_PORT`: COM fijo de la placa.
- `ELECTRONIC_BOARD_USB_VID`
- `ELECTRONIC_BOARD_USB_PID`

Regla actual:

- primero se intenta resolver por `VID/PID`
- si no aparece, se usa el `PORT` del `.env`

## Billetero

Libreria vendor:

- [vendor/peripherals/coins-tech-coins-bill-validator-1.0.2/dist/bill-validator/bill-validator.js](c:/Users/mateo/OneDrive/Escritorio/proyecto%20de%20uniminuto/PPE/vendor/peripherals/coins-tech-coins-bill-validator-1.0.2/dist/bill-validator/bill-validator.js)

Comandos identificados:

- `RESET_COMMAND = [0x30]`
- `SETUP_COMMAND = [0x31]`
- `SECURITY_COMMAND = [0x32, 0x00, 0x00]`
- `POLL_COMMAND = [0x33]`
- `BILL_COMMAND = [0x34, billMaskHi, billMaskLo, escrowHi, escrowLo]`
- `ESCROW_COMMAND = [0x35, escrowState]`
- `STACKER_COMMAND = [0x36]`

Activacion:

- `activate()` envia internamente `billCommand(127, 0)`
- `deactivate()` envia internamente `billCommand(0, 0)`

Mapa de denominaciones detectadas por la libreria:

- `30 80 09` => billete aceptado `$1.000`
- `30 81 09` => billete aceptado `$2.000`
- `30 82 09` => billete aceptado `$5.000`
- `30 83 09` => billete aceptado `$10.000`
- `30 84 09` => billete aceptado `$20.000`
- `30 85 09` => billete aceptado `$50.000`
- `30 86 09` => billete aceptado `$100.000`

Eventos pendientes:

- `30 90 09` => `$1.000`
- `30 91 09` => `$2.000`
- `30 92 09` => `$5.000`
- `30 93 09` => `$10.000`
- `30 94 09` => `$20.000`
- `30 95 09` => `$50.000`
- `30 96 09` => `$100.000`

Eventos retornados:

- `30 C0 09` => `$1.000`
- `30 C1 09` => `$2.000`
- `30 C2 09` => `$5.000`
- `30 C3 09` => `$10.000`
- `30 C4 09` => `$20.000`
- `30 C5 09` => `$50.000`
- `30 C6 09` => `$100.000`

Todo lo que no coincide con esos patrones se expone como dato crudo por `onData`.

## Placa electronica

Libreria vendor:

- [vendor/peripherals/coins-tech-coins-electronic-board-1.0.6/dist/electronic-board/electronic-board.js](c:/Users/mateo/OneDrive/Escritorio/proyecto%20de%20uniminuto/PPE/vendor/peripherals/coins-tech-coins-electronic-board-1.0.6/dist/electronic-board/electronic-board.js)

Comandos identificados:

- `ACTIVATE_COMMAND = [0x06, 0xC9, 0x01, 0x0A, 0x00, 0xDA]`
- `DEACTIVATE_COMMAND = [0x06, 0xC9, 0x01, 0x0C, 0x00, 0xDC]`
- `RETURN_COMMAND = [0x0E, 0xC9, 0x01, 0x3C, bill1, bill2, coin1, coin2, value1, value2, value3, value4, checksumHi, checksumLo]`

Interpretacion actual de tramas de entrada:

- si `trama[0] === 0x06` y `trama[3] === 0xFF`, la libreria lo considera exito
- si `trama[0] === 0x07` y `trama[3] === 51`, la libreria interpreta una moneda
- si `trama[0] === 0x07` y `trama[3] === 50`, la libreria interpreta un billete

Mapa de monedas:

- `trama[3] = 51` y `trama[4] = 100` => `$1.000`
- `trama[3] = 51` y `trama[4] = 50` => `$500`
- `trama[3] = 51` y `trama[4] = 20` => `$200`
- `trama[3] = 51` y `trama[4] = 10` => `$100`
- `trama[3] = 51` y `trama[4] = 5` => `$50`

Mapa de billetes reportados por la placa:

- `trama[3] = 50` y `trama[4] = 100` => `$100.000`
- `trama[3] = 50` y `trama[4] = 50` => `$50.000`
- `trama[3] = 50` y `trama[4] = 20` => `$20.000`
- `trama[3] = 50` y `trama[4] = 10` => `$10.000`
- `trama[3] = 50` y `trama[4] = 5` => `$5.000`
- `trama[3] = 50` y `trama[4] = 2` => `$2.000`
- `trama[3] = 50` y `trama[4] = 1` => `$1.000`

Observacion importante:

- la libreria vendor de la placa ya imprime arreglos crudos en consola con `console.log(this.stack)` y `console.log(trama)`
- por eso el script de diagnostico no necesita duplicar esa captura para empezar a validar entradas reales

## Como probar en campo

1. Ejecutar `npm run diag:cash`.
2. Confirmar en consola el puerto resuelto para `Billetero` y `Placa electronica`.
3. Insertar una moneda y anotar:
   - valor real insertado
   - trama cruda mostrada
   - valor interpretado por la libreria
4. Insertar un billete y anotar:
   - valor real insertado
   - si aparece `PENDING`, `ACCEPTED` o `RETURNED`
   - trama cruda mostrada
   - valor interpretado
5. Si un valor no coincide, documentar la trama exacta para corregir el mapeo en backend antes de tocar `cash_inventory`.

## Validacion real hecha hoy

Pruebas confirmadas en campo sobre la placa electronica:

- Billetes aceptados y reportados correctamente:
  - `$2.000` => `Uint8Array(7) [7, 1, 100, 50, 2, 0, 160]`
  - `$5.000` => `Uint8Array(7) [7, 1, 100, 50, 5, 0, 163]`
  - `$10.000` => `Uint8Array(7) [7, 1, 100, 50, 10, 0, 168]`
  - `$20.000` => `Uint8Array(7) [7, 1, 100, 50, 20, 0, 178]`
- Monedas aceptadas y reportadas correctamente:
  - `$500` => `Uint8Array(7) [7, 1, 100, 51, 50, 0, 209]`
  - `$100` => `Uint8Array(7) [7, 1, 100, 51, 10, 0, 169]`
  - `$50` => `Uint8Array(7) [7, 1, 100, 51, 5, 0, 164]`

Hallazgo operativo importante:

- las monedas nuevas de `$200` no fueron aceptadas por el hardware durante la prueba
- no se capturo trama valida de entrada para `$200` nueva
- por lo tanto, hoy deben considerarse `NO SOPORTADAS EN CAMPO` hasta que se recalibre o reprograme el aceptador de monedas
- no conviene corregir esto en software reasignando otra trama, porque no existe evidencia de una trama distinta para `$200`

Interpretacion recomendada:

- si una moneda nueva de `$200` no genera trama, el problema es fisico o de calibracion del receptor
- si en el futuro genera `trama[3] = 51` y `trama[4] = 20`, quedara soportada sin cambio adicional en backend

## Flujo actual de pago con efectivo

Estado actual del backend validado contra el codigo:

1. La sesion entra en modo cobro con `activateAcceptance(...)`.
2. La placa emite evento `money.received` por moneda o billete detectado.
3. `PaymentSessionService.handlePeripheralMoneyEvent()` registra ese valor llamando `registerCash(...)`.
4. `registerCash(...)` suma en `cash_inventory`, actualiza `insertedAmount` y crea `payment_lines` y `payment_session_events`.
5. Si el monto ya fue cubierto:
   - la sesion pasa a `ReadyToCommit` o `ChangePending`
   - se dispara `autoCompleteSession(...)`
6. Si hay cambio:
   - se calcula el plan desde `dispenser_slots`
   - se envian comandos `RETURN` a la placa
   - se descuentan unidades de los slots
7. Al final se ejecuta `deactivateAcceptance()`, se hace commit al servidor y se emite el evento de pago completado.

Observacion de orden:

- en el flujo actual, el receptor no se apaga justo al cubrir el monto
- primero se determina si hace falta devolver cambio
- si hace falta, la devolucion se ordena y luego se ejecuta `deactivateAcceptance()`
- si queremos endurecer eso despues, podemos apagar recepcion inmediatamente al pasar a `ReadyToCommit` o `ChangePending`

## Filtrado de denominaciones en pruebas

Con el script actual:

- si usamos el billetero independiente, si se puede limitar que billetes aceptar con:

```bash
npm run diag:cash -- --bills-only --accept=1000,2000,5000
```

- eso funciona porque la libreria del billetero soporta `billCommand(mask, 0)`

Limitacion actual:

- si los billetes o monedas entran por la placa electronica, no podemos aceptar unas denominaciones y rechazar otras desde este script
- la libreria legacy de la placa solo expone `activate()` y `deactivate()`
- no encontramos en esa libreria un comando de mascara por denominacion para recepcion

Conclusion practica:

- para la placa: hoy solo podemos activar o desactivar recepcion
- para el billetero independiente: si podemos hacer pruebas selectivas por denominacion
- si el hardware real de tu equipo recibe todo por la placa, el rechazo selectivo tendra que hacerse despues del evento recibido o mediante una capacidad adicional del firmware que hoy no esta expuesta por la libreria vendor

## Siguiente paso recomendado

Cuando confirmemos en campo que las tramas y denominaciones coinciden, el siguiente ajuste debe ser en la capa de aplicacion para:

- sumar entradas validadas en `cash_inventory`
- rechazar denominaciones cuando no exista cambio suficiente en `dispenser_slots`
- registrar cada evento fisico en `cash_movements`
