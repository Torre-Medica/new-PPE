# Tramas de devolucion de la placa

## Forma de la trama

La tarjeta recibe una trama `RETURN` (misma forma que `returnCommand` de la
libreria vendor `coins-tech-coins-electronic-board`):

```text
[0x0E, 0xC9, 0x01, 0x3C, b4, b5, b6, b7, total_1, total_2, total_3, total_4, checksum_hi, checksum_lo]
```

- `b4` = denominacion de `bill1` / 1000
- `b5` = denominacion de `bill2` / 1000
- `b6` = denominacion de `coin1` / 10
- `b7` = denominacion de `coin2` / 10
- `total` = valor a devolver en pesos (4 bytes, big endian)
- checksum = suma de los 12 primeros bytes (2 bytes)

La placa reparte el `total` con lo que le decimos que hay en cada caja y responde
un `ACK` (trama que empieza en `6`, exito si el byte 3 es `255`).

## Regla del PPE: no mentirle a la placa

`b4..b7` son SIEMPRE las denominaciones reales cargadas hoy en `dispenser_slots`
(slot inactivo o sin denominacion = 0). Nunca se mandan selectores ficticios.

| Uso | Funcion | Total | ACK |
|---|---|---|---|
| Cambio de un pago completado | `PeripheralsService.returnChange` | cambio del pago | no se espera |
| Devolucion por cancelacion / timeout | `PeripheralsService.returnChangeConfirmed` | lo ingresado por el cliente (menos remanente no representable) | se espera |
| Boton "Expulsar" (vista Dispositivos) | `PeripheralsService.ejectUnits` | denominacion del slot, una trama por unidad | se espera |

La expulsion manual va de a una unidad porque con un total mayor la placa podria
repartirlo desde otra caja (ej. 5 x $100 = $500 podria salir como 1 moneda de $500).

Una trama de total nunca se reintenta: un ACK perdido no prueba que el dinero no
haya salido, y reenviarla podria devolverlo dos veces.

## Ejemplos con la carga actual

Cajas: `bill1 = 10000`, `bill2 = 2000`, `coin1 = 500`, `coin2 = 100` → `b4..b7 = [10, 2, 50, 10]`.

| Accion | Total | Resultado esperado |
|---|---:|---|
| Expulsar 1 de monedero 1 (`coin1`) | 500 | 1 moneda de $500 |
| Expulsar 1 de monedero 2 (`coin2`) | 100 | 1 moneda de $100 |
| Expulsar 1 de billetero 2 (`bill2`) | 2000 | 1 billete de $2.000 |
| Devolver $12.600 | 12600 | 1 x $10.000, 1 x $2.000, 1 x $500, 1 x $100 |

Trama de control confirmada en campo (una unidad de cada caja):

```text
0E C9 01 3C 0A 02 32 0A 00 00 31 38 01 C5
```
