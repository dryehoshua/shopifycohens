# Procedimientos operativos propuestos

## Alta o actualización de producto

1. Confirmar nombre, variante, proveedor y categoría.
2. Asignar SKU único y código de barras cuando aplique.
3. Capturar precio de venta y costo unitario.
4. Activar seguimiento de inventario y ubicación correcta.
5. Verificar impuestos y unidad de venta: pieza, peso, paquete o fracción.
6. Publicar sólo después de una revisión de datos.

## Compra y recepción

1. Crear la orden de compra antes de que llegue la mercancía.
2. Registrar proveedor, costo, cantidades y fecha estimada.
3. Marcarla como Pedido y vincular la transferencia.
4. Preparar el envío y marcarlo listo o en tránsito.
5. Al llegar, abrir **Recibir envío**.
6. Con una pistola en modo HID/teclado, escanear una vez cada unidad aceptada.
7. Registrar por separado rechazados, daños y faltantes.
8. Comparar el resumen escaneado contra factura y conteo físico.
9. Guardar la recepción.
10. Actualizar el último costo aprobado cuando corresponda.
11. Confirmar que el disponible de la ubicación seleccionada aumentó exactamente
    lo aceptado.
12. Guardar factura y evidencia fuera de Git.

El diseño del módulo y su prueba de aceptación están en
`docs/MODULO_1_INVENTARIO.md`.

## Alta de código de barras

1. Tomar una unidad física y abrir la variante correcta.
2. Enfocar el campo Código de barras y escanear.
3. Confirmar presentación, proveedor y SKU antes de guardar.
4. Probar una segunda lectura.
5. Resolver duplicados antes de continuar.

No se inventan códigos de fábrica ni se reutiliza un código entre variantes.

## Ajuste de inventario

1. Recontar antes de ajustar.
2. Elegir motivo correcto: conteo, daño, merma, devolución o corrección.
3. Agregar nota con contexto suficiente.
4. Revisar semanalmente ajustes por usuario y producto.
5. Escalar ajustes repetidos o negativos.

## Venta en POS

1. Abrir sesión de caja por turno.
2. Escanear o seleccionar el producto correcto.
3. Asociar cliente antes de cobrar.
4. Confirmar descuentos y método de pago.
5. Completar el cobro.
6. Imprimir o enviar el recibo.
7. Cerrar y conciliar la sesión al finalizar el turno.

## Revisión diaria

- sesiones de caja abiertas;
- inventario negativo;
- productos agotados y bajo umbral;
- recepciones pendientes;
- entregas parciales, rechazadas o sin cerrar;
- devoluciones o descuentos fuera de patrón;
- fallas de impresora o dispositivo offline.

## Revisión semanal

- ventas sin costo;
- margen por producto y categoría;
- productos sin SKU o código de barras;
- ajustes y mermas;
- exactitud de conteos cíclicos;
- porcentaje de ventas con cliente;
- clientes recurrentes y en riesgo;
- ejecuciones y errores de Shopify Flow.
