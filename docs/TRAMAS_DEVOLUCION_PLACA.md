# Tramas de devolucion de la placa

## Como funciona la tarjeta

La tarjeta recibe una trama `RETURN` con esta forma:

```text
[0x0E, 0xC9, 0x01, 0x3C, b4, b5, b6, b7, total_1, total_2, total_3, total_4, checksum_hi, checksum_lo]
```

Lo que entendimos en pruebas reales:

- `b4`, `b5`, `b6` y `b7` no son solo denominaciones reales
- esos cuatro campos sirven para seleccionar el slot y el modo interno de devolucion
- el campo `total` controla cuantas unidades expulsa la tarjeta
- la tarjeta responde `ACK`, pero el `ACK` no garantiza por si solo la expulsion fisica
- la verdad del negocio sigue estando en `dispenser_slots`
- el backend del PPE debe calcular la devuelta y usar estas tramas solo para forzar la expulsion de unidades

## Tramas que usaremos

### Billetero 1

Trama base:

```text
[2, 50, 5, 5]
```

Regla:

- `total = cantidad * 2000`

Ejemplos confirmados:

| Cantidad | Total | Resultado |
|---|---:|---|
| 1 | 2000 | 1 billete de `bill1` |
| 2 | 4000 | 2 billetes de `bill1` |
| 3 | 6000 | 3 billetes de `bill1` |
| 9 | 18000 | 9 billetes de `bill1` |

Nota:

- techo confirmado: `9` billetes por orden

### Billetero 2

Trama base:

```text
[50, 2, 5, 5]
```

Regla:

- `total = cantidad * 2000`

Ejemplos confirmados:

| Cantidad | Total | Resultado |
|---|---:|---|
| 1 | 2000 | 1 billete de `bill2` |
| 2 | 4000 | 2 billetes de `bill2` |
| 3 | 6000 | 3 billetes de `bill2` |

Nota:

- falta confirmar el techo maximo, pero por simetria se espera `9`

### Monedero 1

Trama base:

```text
[50, 50, 50, 5]
```

Regla:

- `total = cantidad * 50`

Ejemplos confirmados:

| Cantidad | Total | Resultado |
|---|---:|---|
| 1 | 50 | 1 moneda de `coin1` |
| 2 | 100 | 2 monedas de `coin1` |
| 3 | 150 | 3 monedas de `coin1` |

### Monedero 2

Trama base:

```text
[50, 50, 5, 50]
```

Regla:

- `total = cantidad * 50`

Ejemplos confirmados:

| Cantidad | Total | Resultado |
|---|---:|---|
| 1 | 50 | 1 moneda de `coin2` |
| 2 | 100 | 2 monedas de `coin2` |
| 3 | 150 | 3 monedas de `coin2` |
| 4 | 200 | 4 monedas de `coin2` |
| 5 | 250 | 5 monedas de `coin2` |
| 6 | 300 | 6 monedas de `coin2` |
| 7 | 350 | 7 monedas de `coin2` |
| 8 | 400 | 8 monedas de `coin2` |
| 9 | 450 | 9 monedas de `coin2` |
| 10 | 500 | 10 monedas de `coin2` |

## Una unidad por slot

| Slot | Bytes [b4,b5,b6,b7] | Total | Resultado esperado |
|---|---|---:|---|
| `bill1` | `[2, 50, 5, 5]` | 2000 | 1 billete |
| `bill2` | `[50, 2, 5, 5]` | 2000 | 1 billete |
| `coin1` | `[50, 50, 50, 5]` | 50 | 1 moneda |
| `coin2` | `[50, 50, 5, 50]` | 50 | 1 moneda |

## Regla general que usaremos en el PPE

| Slot | Trama base | Formula |
|---|---|---|
| `bill1` | `[2, 50, 5, 5]` | `total = cantidad * 2000` |
| `bill2` | `[50, 2, 5, 5]` | `total = cantidad * 2000` |
| `coin1` | `[50, 50, 50, 5]` | `total = cantidad * 50` |
| `coin2` | `[50, 50, 5, 50]` | `total = cantidad * 50` |

## Trama de control

Esta trama entrego una unidad de cada slot:

```text
0E C9 01 3C 0A 02 32 0A 00 00 31 38 01 C5
```

Interpretacion:

- `bill1 = 10000`
- `bill2 = 2000`
- `coin1 = 500`
- `coin2 = 100`
- `total = 12600`

Resultado confirmado:

- 1 billete de `bill1`
- 1 billete de `bill2`
- 1 moneda de `coin1`
- 1 moneda de `coin2`
