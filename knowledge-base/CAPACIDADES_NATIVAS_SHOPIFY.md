# Capacidades nativas de Shopify

## Inventario

Shopify registra cantidades disponibles, comprometidas, entrantes y no disponibles
por ubicación. El historial de ajustes conserva fecha, actividad, usuario, motivo y
cambio de cantidad.

Para responder "qué día entró", se debe recibir la mercancía mediante una orden de
compra o transferencia. Así quedan la creación, envío, llegada estimada y recepción.
Un ajuste manual sólo demuestra cuándo se corrigió una cantidad, no el documento de
compra que la originó.

Shopify no debe considerarse trazabilidad completa de lote o caducidad sin una
prueba específica.

## Compras y recepción

Las órdenes de compra permiten proveedor, productos, cantidades, costo, envío,
impuestos y fecha estimada. La transferencia vinculada registra unidades aceptadas,
rechazadas y recepción parcial.

La administración nativa de transferencias permite recibir un envío escaneando
artículos individuales con una pistola externa configurada en modo HID/teclado. Cada
lectura aumenta el conteo aceptado y la existencia cambia al guardar. Esto evita una
dependencia nueva de Stocky, cuya descontinuación está anunciada para el 31 de agosto
de 2026.

Para que el escaneo sea confiable, cada variante debe tener un código de barras único
en Shopify. El escáner no sustituye el saneamiento de SKU, variantes, presentaciones
o códigos duplicados.

## Ventas y utilidad

Los informes de beneficio muestran ventas netas, costo de mercancía vendida,
utilidad bruta y margen por producto, pedido y ubicación. Descuentos, devoluciones y
reversiones forman parte de la venta neta.

El costo usado es el registrado en el producto al momento de la venta. Cambiarlo
después no reescribe automáticamente el pasado. La disciplina de costo debe formar
parte de cada recepción.

Shopify no conoce por sí solo renta, nómina, luz, comisiones externas, regalías ni
otros gastos operativos. Esa información es necesaria para utilidad neta.

## Alertas

Shopify Flow puede enviar correo por inventario bajo. Se puede usar un disparador por
cambio de cantidad o un resumen programado. Debe evitarse el envío repetido: es
preferible alertar al cruzar el umbral o enviar un resumen diario.

## POS y recibos

POS Pro incluye:

- editor de tablero;
- personalización de recibos;
- recibo impreso, correo electrónico o mensaje de texto;
- impresión automática en hardware compatible;
- seguimiento de caja y empleados.

La impresión se configura en cada dispositivo. Shopify soporta modelos específicos
Star y Epson; "ESC/POS" por sí solo no garantiza compatibilidad.

## Clientes

Shopify conserva pedidos, gasto, recurrencia y contacto por cliente. Los informes
incluyen RFM, cohortes y clientes recurrentes. Los segmentos pueden agrupar clientes
por comportamiento.

Una venta sin cliente no puede alimentar el historial. En caja se debe asociar el
cliente antes de cobrar y recopilar consentimiento por canal de forma separada.

## WhatsApp

La app instalada sirve para comunicaciones y actualizaciones relacionadas con
pedidos. El marketing segmentado necesita:

1. identidad y teléfono confiables;
2. consentimiento válido;
3. segmento y finalidad;
4. plantilla aprobada cuando corresponda;
5. medición de bajas, respuesta y conversión.

No se debe importar o contactar masivamente a clientes sin validar consentimiento.

## Base de datos

Durante la primera etapa Shopify es la base transaccional. Una base externa sólo
debe añadirse para analítica histórica, integración contable, franquicias,
trazabilidad o automatizaciones que Shopify no pueda cubrir.
