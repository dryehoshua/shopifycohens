# Cohens Operations · análisis y plan

## Objetivos del sistema

1. **Existencias:** conocer cuánto hay, cuándo entró, qué se vendió y mantener
   trazabilidad de cada cambio.
2. **Utilidades:** mostrar costo, precio de venta, venta neta, utilidad bruta y
   margen; conservar el resultado en base de datos y generar estadísticas.
3. **Alertas de inventario:** avisar cuando un producto cruce su umbral mínimo,
   evitando mensajes repetidos.
4. **Recibos:** entregar un recibo listo para imprimir al terminar una venta,
   sujeto a compatibilidad de la impresora con Shopify POS.
5. **Clientes:** consultar compras, recurrencia y comportamiento por cliente.
6. **WhatsApp:** evaluar comunicación operativa y campañas únicamente con
   identidad, teléfono y consentimiento válidos.

## Diagnóstico funcional

Shopify cubre de forma nativa productos, ubicaciones, saldos, pedidos, clientes,
transferencias, POS y parte de los informes. El desarrollo propio se concentra en
los flujos que requieren menos pasos, auditoría adicional o una presentación
operativa específica.

La estrategia es mantener Shopify como fuente transaccional y usar Cohens
Operations como capa de operación y análisis. Esto evita mantener dos inventarios
independientes.

## Módulos implementados

### 1. Inventario y entradas

- recepción desde PC y extensión Shopify POS;
- lectura exacta de código de barras;
- cantidad, proveedor y nota;
- alta de un proveedor nuevo si no existe;
- ajuste incremental idempotente;
- fecha y hora en la zona operativa;
- folio y evidencia del saldo anterior y resultante;
- corrección mediante movimiento inverso enlazado.

### 2. Analíticos de utilidad

- importación histórica y sincronización por webhooks;
- pedidos, partidas y reembolsos persistidos;
- utilidad bruta estimada usando costo vigente;
- cobertura separada para ventas cuyo producto no tiene costo;
- filtros por periodo y rango de fechas;
- orden ascendente y descendente desde cada encabezado;
- desglose por producto y pedidos recientes.

## Próximas etapas

1. Definir umbrales por producto y activar alertas de inventario bajo.
2. Validar el modelo exacto de impresora y la modalidad PC/POS del recibo.
3. Normalizar captura de cliente en caja y construir indicadores de recurrencia.
4. Validar consentimiento y proveedor para WhatsApp.
5. Migrar SQLite a una base administrada y publicar el backend en HTTPS estable.
6. Añadir pruebas automatizadas, monitoreo, respaldos y recuperación.

## Criterios transversales

- permisos mínimos;
- operaciones idempotentes;
- registros inmutables o compensatorios;
- ningún secreto o dato comercial en Git;
- pruebas de escritura sólo en tienda de desarrollo;
- conciliación periódica con Shopify.
