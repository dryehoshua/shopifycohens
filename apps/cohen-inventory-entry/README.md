# Cohens Operations · aplicación Shopify

Aplicación Shopify modular con tres apartados activos. **Inventario y entradas**
registra mercancía desde PC o Shopify POS mediante código de barras.
**Analíticos de utilidad** sincroniza ventas y calcula utilidad bruta estimada
con el “Costo por artículo” vigente. **Nekudot Cohen's** comparte una wallet
entre tienda y cafetería: acredita 5% al cliente, separa 5% para su broker y
permite canjear el saldo en compras posteriores mediante RFID o QR.

## Nekudot Cohen's

La ruta embebida `/app/cashback` administra miembros, tarjetas/QR, brokers,
saldos y el libro mayor. La extensión `Nekudot Cohen's` funciona dentro de
Shopify POS; la POS web de la cafetería ofrece el mismo lector y canje.

### Dinámica de venta

1. El personal termina de capturar y cobrar la compra.
2. Shopify POS muestra **“¿El cliente tiene tarjeta Cohen's?”** en la pantalla
   posterior a la compra. En la cafetería, la pregunta aparece antes de cobrar.
3. Si responde que sí, se escanea el RFID o QR. La tarjeta solo entrega la
   llave del perfil; nunca contiene saldo.
4. El backend verifica que el pedido esté pagado, asocia el cliente de Shopify
   y acredita 5% al cliente y 5% a su broker.
5. El pedido y los webhooks de Shopify son la fuente de verdad. Repetir el
   escaneo o recibir de nuevo un webhook no duplica puntos.

Cuando una tarjeta se pierde, el empleado busca al cliente existente en
**Nekudot > Miembros**, revisa personalmente su identificación, escanea la
tarjeta nueva y usa **Reemplazar tarjeta perdida**. Todas las credenciales
anteriores quedan revocadas, la operación se audita y el saldo permanece en el
mismo perfil.

El pedido pagado es la fuente de verdad. Cada compra acredita 5% sobre su venta
neta; una devolución revierte proporcionalmente cashback, comisión y Nekudot
canjeados. El ID original nunca se guarda: se persiste únicamente su HMAC. Para
compartir saldo entre dos tiendas Shopify, ambas instalaciones deben apuntar al
mismo servicio y a la misma base de datos de Cohens Operations.

## Objetivo 2 · Analíticos de utilidad

La ruta embebida `/app/profit` contiene filtros de hoy, 7 días, 30 días y todo
el historial, además de:

- venta neta después de descuentos y unidades reembolsadas;
- costo calculable por cantidad neta y costo vigente;
- utilidad bruta y margen por producto;
- ordenamiento de toda la base por producto, SKU, unidades, venta neta, costo,
  utilidad o margen, en ambas direcciones;
- cobertura de costo y lista accionable de productos sin costo;
- artículos reembolsados y transacciones financieras exitosas;
- pedidos recientes y serie diaria;
- exclusión explícita de pruebas, cancelaciones y pagos pendientes.

La importación completa se ejecuta con `pnpm sales:sync`. Las actualizaciones de
pedidos y reembolsos se reciben en `/webhooks/sales-sync`. El cálculo conserva
pedidos, partidas, reembolsos, ejecuciones y capturas de costo en la base local.
El reembolso no se resta dos veces: Shopify entrega la venta de línea sin
cantidades reembolsadas o retiradas y la app calcula el costo con la cantidad
neta restante.

Esta cifra es utilidad bruta estimada, no utilidad neta. El costo es el vigente
al momento de sincronizar, porque Shopify no conserva un costo histórico
completo para todas las ventas anteriores.

## Flujo desde PC

1. El empleado abre **Registrar entrada PC** dentro del administrador de Shopify.
2. Selecciona la ubicación y escanea una pieza con una pistola configurada como
   teclado/HID y terminador Enter.
3. La app busca una coincidencia exacta de código y muestra la existencia actual.
4. La app preselecciona el proveedor asociado al producto; el empleado captura
   cantidad y nota, o registra un proveedor nuevo si todavía no existe.
5. La app muestra el saldo resultante.
6. Al confirmar, el backend aplica un ajuste incremental idempotente en Shopify.
7. La app guarda el folio, usuario, origen de escritorio y saldos anterior/nuevo.
8. Una corrección crea un movimiento inverso enlazado; nunca borra el original.

Ruta embebida:

```text
/app/receive
```

## Flujo desde Shopify POS

El mismo backend también está conectado al mosaico **Registrar entrada** de
Shopify POS. En móvil o tableta se puede escanear con pistola compatible, escáner
integrado o cámara. PC y POS usan las mismas reglas de inventario, idempotencia,
bitácora y corrección.

## Componentes

- `app/routes/app.profit.tsx`: panel de utilidad bruta.
- `app/routes/app.cashback.tsx`: administración de Nekudot y brokers.
- `app/nekudot.server.ts`: wallet central, reserva, canje y conciliación.
- `extensions/nekudot-pos`: mosaico y modal de Nekudot para Shopify POS.
- `hardware/acr122u-reader.c`: lectura nativa PC/SC del UID NFC.
- `scripts/nekudot-nfc-bridge.mjs`: puente local seguro entre el ACR122U y
  las pantallas web de tienda/cafetería.

## Lector NFC ACR122U

El ACR122U se integra mediante CCID/PC/SC en Windows y macOS. No funciona como
teclado y no requiere WebUSB. El puente escucha únicamente en
`127.0.0.1:17812`, lee el UID público de la tarjeta y nunca lee sus bloques de
memoria. La POS conserva el UID sólo durante la operación activa; las ventas en
espera exigen volver a acercar la tarjeta y la base central persiste únicamente
su HMAC.

### Windows

En **Retail POS > Lector NFC**, descarga **Instalar en Windows** y abre
`cohens-nfc-windows.cmd`. El instalador configura Node.js, compila el lector
PC/SC, instala el puente para el usuario actual y lo inicia automáticamente con
Windows. Un watchdog mantiene vivo el proceso y lo reinicia dos segundos después
de cualquier cierre inesperado. La POS también vuelve a conectarse al abrirse,
al recuperar el foco o cuando regresa la conexión. Antes de instalar verifica
por SHA-256 el instalador, Node.js, el lector, el watchdog y el propio puente.
Al terminar, realiza tres lecturas estables desde la prueba de la POS.

### macOS y desarrollo local

En la Mac conectada al lector, o durante desarrollo:

```sh
pnpm nfc:start
```

Después abre `http://127.0.0.1:17812` para la prueba diagnóstica o entra a
Nekudot en Shopify. Las pantallas **Escanear**, **Vincular cliente**, Retail POS
y la POS de la cafetería detectan el puente automáticamente. Una tarjeta debe
retirarse y acercarse de nuevo para producir otra lectura.

Shopify Admin puede impedir que su iframe consulte directamente una dirección
local. En ese caso el puente activa una entrada nativa restringida: solo escribe
el UID si el elemento enfocado es un campo cuyo texto de ayuda empieza con
**Escanea** o **Esperando lectura**, y después envía Enter. macOS puede pedir una
sola vez permiso de Accesibilidad para la terminal o aplicación que inició el
puente. Se puede desactivar con `NEKUDOT_NFC_KEYBOARD_FALLBACK=0`.

Por seguridad, el puente solo acepta `localhost`, la URL productiva principal
y los orígenes declarados en `NEKUDOT_NFC_ALLOWED_ORIGINS` (separados por
coma). Para una segunda app productiva de cafetería, agrega su origen HTTPS a
esa variable antes de iniciar el puente.

El UID se usa como identificador de fidelidad, no como factor de pago o
autenticación. La base de datos conserva únicamente su HMAC, nunca el UID en
texto claro.
- `app/sales-sync.server.ts`: actualización idempotente por webhook.
- `scripts/sync-sales-from-shopify.mjs`: importación histórica completa.
- `app/routes/webhooks.sales-sync.tsx`: pedidos y reembolsos nuevos.
- `app/routes/app.receive.tsx`: pantalla de recepción desde PC.
- `app/inventory-operations.server.ts`: operaciones compartidas por PC y POS.
- `app/supplier.server.ts`: sincronización y alta del catálogo de proveedores.
- `extensions/registrar-entrada-pos`: mosaico y modal Preact para Shopify POS
  API `2026-07`.
- `app/routes/api.pos.inventory.lookup.ts`: consulta exacta por código.
- `app/routes/api.pos.inventory.receive.ts`: entrada idempotente.
- `app/routes/api.pos.inventory.reverse.$movementId.ts`: corrección compensatoria.
- `app/routes/api.pos.inventory.movements.ts`: movimientos recientes del POS.
- `app/routes/webhooks.inventory-audit.tsx`: evidencia de cambios y eliminaciones.
- `app/routes/app.inventory-reconciliation.tsx`: incidencias y conciliación manual.
- `app/routes/api.inventory.reconcile.ts`: entrada protegida para conciliación diaria.
- `app/inventory-reconciliation.server.ts`: validación de evidencia y cambios externos.
- `app/routes/app._index.tsx`: panel administrativo y bitácora.
- `app/inventory.server.ts`: reglas de dominio y GraphQL Admin API.
- `prisma/schema.prisma`: sesiones, movimientos y eventos de auditoría.

## Controles de integridad

- código de barras obligatorio y coincidencia exacta;
- rechazo de códigos duplicados;
- seguimiento de inventario obligatorio;
- ubicación activa del POS;
- cantidad entera positiva;
- clave única por operación;
- directiva Shopify `@idempotent`;
- `changeFromQuantity` para detectar concurrencia;
- movimientos terminales conservados;
- una sola reversión por entrada;
- motivo obligatorio para corregir;
- proveedor obligatorio tomado de un selector persistente;
- fecha y hora UTC en base de datos y presentación en
  `America/Mexico_City`;
- payload de webhook único.

## Permisos Shopify

```text
read_products
write_products
read_inventory
write_inventory
read_locations
read_orders
write_orders
read_all_orders
read_customers
```

El usuario que opera POS también necesita permiso para aplicar cambios de
inventario.

`write_products` y `read_locations` se usan para preparar y verificar la tienda
de desarrollo. La instalación productiva debe reducir los permisos al conjunto
que realmente requiera la versión que se publique.

## Migración del catálogo a la tienda de desarrollo

El importador usa la tienda de desarrollo indicada en `SHOPIFY_DEV_STORE`,
conserva un punto de reanudación por producto y no duplica los handles ya
terminados.

```bash
pnpm catalog:dry-run
pnpm catalog:pilot
pnpm catalog:import
pnpm catalog:verify
```

La fuente local es
`data/backups/shopify-2026-07-27/cohens-products-master.csv`. El resultado y el
punto de reanudación se guardan en el mismo directorio.

## Desarrollo local

La base local es SQLite y sólo se usa para desarrollo. Las pruebas de escritura
se hacen exclusivamente en la tienda indicada por `SHOPIFY_DEV_STORE`; no se
automatizan contra la tienda productiva.

```bash
pnpm install
pnpm prisma migrate dev
pnpm typecheck
pnpm build
pnpm shopify app build
```

## Publicación

La tienda de Cohen es productiva y Shopify no acepta `shopify app dev` como
servidor temporal para ella. Antes de instalar:

1. publicar el backend en una URL HTTPS estable;
2. usar una base de datos de producción con respaldos;
3. configurar `SHOPIFY_APP_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` y
   `SCOPES`, además de un `NEKUDOT_TOKEN_SECRET` aleatorio;
4. cambiar `application_url` y `redirect_urls` en `shopify.app.toml`;
5. aplicar migraciones;
6. liberar la versión de la extensión;
7. instalar la app en la tienda;
8. agregar el mosaico a Shopify POS;
9. realizar una prueba física controlada con dos unidades.

### Conciliación diaria de inventario

Configura `INVENTORY_RECONCILIATION_SECRET` con un valor aleatorio largo y crea
un cron diario que envíe `POST /api/inventory/reconcile` con el encabezado
`Authorization: Bearer <secreto>`. El cuerpo puede ser `{}` para todas las
tiendas instaladas o `{"shop":"tienda.myshopify.com"}` para una sola. La clave
diaria es idempotente: repetir el cron en la misma fecha devuelve la misma
ejecución. El proceso consulta Shopify y actualiza evidencia e incidencias
locales; nunca modifica existencias.

En Railway, crea **un servicio cron separado** a partir del mismo repositorio;
no conviertas el servicio web persistente en cron. Usa como comando de inicio
`pnpm run inventory:reconcile`, comparte `SHOPIFY_APP_URL` e
`INVENTORY_RECONCILIATION_SECRET` con el servicio web y, si sólo debe revisar
una tienda, agrega `INVENTORY_RECONCILIATION_SHOP`. El archivo
`railway.inventory-reconciliation-cron.example.json` contiene una configuración
de referencia para ejecutarlo diariamente a las 11:00 UTC. El proceso termina
con error si falta configuración, vence el límite de 15 minutos o el endpoint
no responde satisfactoriamente, de modo que Railway lo muestra como ejecución
fallida.

El panel **Conciliación de inventario** permite ejecutar la revisión a demanda,
filtrar cambios externos y documentar el resultado de un conteo físico. Un
movimiento con estado `RECONCILING` debe reintentarse desde la misma pantalla de
recepción; PC y POS conservan el folio hasta recibir una confirmación terminal.

SQLite no debe utilizarse como base definitiva de una instalación con varias
cajas. La publicación productiva debe usar PostgreSQL administrado o una
alternativa transaccional equivalente.
