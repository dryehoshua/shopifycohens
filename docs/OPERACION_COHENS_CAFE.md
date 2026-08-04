# Operación de Cohen's Cafe en Shopify POS

## Estado transitorio en la tienda principal

Esta configuración se conserva únicamente durante la prueba y el corte hacia la
tienda independiente descrita en `OPERACION_COHENS_CAFE_INDEPENDIENTE.md`. No se
elimina porque mantiene el historial previo. Después de validar la nueva tienda,
los productos se despublicarán y la ubicación se desactivará sin borrar pedidos.

Dentro de la tienda principal se identifica mediante:

- ubicación POS: `Cohen's Cafe`;
- proveedor: `Cohen's Cafe`;
- tipo de producto: `Cafetería`;
- colección: `Cohen's Cafe`;
- etiqueta operativa: `cohens-cafe`;
- SKUs consecutivos con prefijo `CAF-`.

La nueva tienda sí mantendrá clientes, pedidos, inventario, permisos, suscripción
y analíticos independientes, según la decisión operativa actual.

## Configuración aplicada

- Ubicación activa: `Cohen's Cafe` (Shopify location ID `93866098936`).
- Plantilla de tablero inteligente: `Cohen's Cafe`.
- Asignación de plantilla: únicamente a la ubicación `Cohen's Cafe`; `Plaza Victoria` conserva su tablero.
- Recuadro principal: colección `Cohen's Cafe`, con 9 productos activos publicados en Point of Sale.
- Productos protegidos: 4 borradores sin precio confirmado, no disponibles para cobro.
- Catálogo por ubicación: la tablet de `Cohen's Cafe` debe tener activos únicamente los artículos con etiqueta `cohens-cafe`; Plaza Victoria conserva su catálogo completo.

## Uso diario en POS

1. Abrir Shopify POS e iniciar sesión en la ubicación `Cohen's Cafe`.
2. Confirmar en `☰ > Configuración > Ubicación` que el dispositivo diga `Cohen's Cafe`.
3. En la cuadrícula principal tocar el mosaico `Cohen's Cafe`.
4. Elegir el producto; si tiene variantes, seleccionar temperatura, sabor o presentación.
5. Agregar cliente cuando esté identificado.
6. Cobrar y entregar o imprimir el recibo.
7. No usar "venta personalizada" para productos del menú: impediría medir correctamente unidades, utilidad y devoluciones por producto.

## Estado inicial del catálogo

Los productos con precio conocido se activan para POS. Café americano, capuchino, tamal de hoja de maíz y quesadilla permanecen como borrador hasta confirmar su costo y precio. Esto evita ventas accidentales a $0.

Los alimentos preparados no controlan existencias como producto terminado en esta primera etapa. El inventario debe aplicarse después a ingredientes y empaques mediante recetas o consumo teórico; descontar una unidad de "café" no representa correctamente leche, grano, vaso y tapa.

## Monitoreo

En Shopify Admin, abrir `Analytics > Reports > Retail sales` y usar:

- ventas POS por ubicación, filtrando `Cohen's Cafe`;
- ventas POS por tipo de producto, filtrando `Cafetería`;
- ventas POS por producto o variante;
- ventas POS por empleado;
- cantidad neta para que las devoluciones se descuenten.

En Cohens Operations, los productos quedan diferenciados por el tipo `Cafetería` y proveedor `Cohen's Cafe`, por lo que el panel de utilidad puede incorporar un filtro exclusivo para esta unidad.

## Cierre de turno

1. Confirmar que el dispositivo siga conectado a `Cohen's Cafe`.
2. Cerrar la sesión de seguimiento de efectivo si se usa caja en efectivo.
3. Revisar devoluciones, descuentos y ventas personalizadas.
4. Comparar cobro real con el reporte de caja.
5. Registrar mermas o consumo interno por separado; no eliminarlos como si nunca hubieran ocurrido.

## Cambios posteriores

Cuando el dueño actualice el Excel, corregir precio y costo en las variantes existentes. No crear productos nuevos para corregir un precio: conservar el mismo SKU mantiene continuo el historial de ventas.
