# Módulo 2 · Analíticos de utilidad

## Propósito

Explicar cuánto deja cada producto después de descuentos y reembolsos, utilizando
el costo registrado en Shopify.

## Fórmula

```text
venta neta de la partida
- cantidad neta × costo vigente por artículo
= utilidad bruta estimada
```

El margen se calcula sobre la venta cubierta por un costo conocido. Renta, nómina,
servicios, comisiones externas, mermas y otros gastos operativos no forman parte de
esta cifra, por lo que no debe llamarse utilidad neta.

## Reembolsos

Shopify entrega la cantidad y la venta actuales de la partida después de unidades
reembolsadas o retiradas. El módulo usa esa cantidad neta para revertir también el
costo correspondiente. El pago reembolsado se conserva como control financiero,
pero no se resta otra vez de la venta.

## Costos faltantes

Una partida sin **Costo por artículo** no se interpreta como costo cero:

- su venta permanece en los totales;
- queda fuera de la utilidad calculable;
- aumenta el importe de cobertura pendiente;
- aparece en la lista accionable de productos sin costo.

## Panel

El panel incluye:

- venta neta, costo calculable, utilidad bruta y margen;
- cobertura de costos;
- descuentos y reembolsos;
- serie diaria;
- base por producto, SKU, unidades, venta, costo, utilidad y margen;
- flechas ascendentes y descendentes en cada encabezado;
- accesos rápidos de hoy, 7 días, 30 días y todo;
- rango personalizado **Desde/Hasta**;
- pedidos recientes y exclusiones explícitas.

## Persistencia

La base de datos conserva pedidos, partidas, reembolsos, ejecuciones de
sincronización y la captura de costo usada. Los webhooks actualizan de forma
idempotente los pedidos nuevos, modificados o reembolsados.

## Limitación de costo histórico

El panel usa el costo vigente al sincronizar. Si se necesita rentabilidad histórica
contable, cada recepción deberá conservar el costo por lote o integrarse con el
sistema contable correspondiente.
