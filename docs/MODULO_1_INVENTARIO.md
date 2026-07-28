# Módulo 1 · Inventario y entradas

## Propósito

Registrar mercancía con una pistola de código de barras, actualizar el inventario
de Shopify y conservar evidencia suficiente para investigar o corregir errores.

## Flujo desde PC

1. Abrir **Cohens Operations → Inventario · Registrar entrada**.
2. Seleccionar la ubicación.
3. Escanear un código de barras con la pistola en modo teclado/HID.
4. Confirmar producto, variante, imagen y existencia actual.
5. Elegir el proveedor de la lista o registrar uno nuevo.
6. Capturar cantidad y nota.
7. Confirmar la entrada.
8. Revisar folio, hora y saldo resultante.

Shopify recibe un ajuste incremental. La aplicación conserva el movimiento con su
clave idempotente para impedir duplicados por doble clic o reintentos.

## Flujo desde Shopify POS

El mosaico **Registrar entrada** usa el mismo backend y las mismas validaciones.
La lectura puede venir de un escáner compatible o de los mecanismos disponibles
en el dispositivo POS.

## Auditoría y correcciones

Cada movimiento conserva:

- tienda y ubicación;
- fecha y hora;
- usuario o empleado;
- producto, variante, SKU y código;
- proveedor y nota;
- cantidad aplicada;
- saldo anterior y resultante;
- estado y error, si lo hubo.

Una corrección no elimina el original. Crea un movimiento inverso, con motivo
obligatorio y vínculo al folio inicial.

## Requisitos físicos

- códigos de barras únicos por variante;
- seguimiento de inventario habilitado;
- pistola configurada como teclado/HID con terminador Enter;
- ubicación correcta seleccionada;
- permisos de productos, inventario y ubicación;
- conteo físico inicial y pruebas controladas.

## Casos que se rechazan

- código vacío, desconocido o duplicado;
- producto sin seguimiento de inventario;
- ubicación inactiva;
- cantidad no entera o no positiva;
- saldo concurrente distinto al esperado;
- segundo intento con la misma clave;
- segunda reversión de la misma entrada.

## Fuente de verdad

Shopify conserva la existencia oficial. Cohens Operations conserva la experiencia
de recepción y una bitácora adicional; no calcula un saldo independiente.
