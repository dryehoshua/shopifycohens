# Cohen's Cafe como tienda independiente

## Arquitectura productiva

Cohen's Cafe opera como una tercera tienda Shopify separada de `main` y `dev`.
No comparte catálogo, pedidos ni inventario con la tienda principal. Nekudot es
la excepción deliberada: ambas instalaciones deben conectarse al mismo servicio
y base central de Cohens Operations para que tarjeta, saldo y broker sean
únicos. Las sesiones continúan separadas por dominio de tienda.

Configuración prevista:

- tienda: `cohens-cafe.myshopify.com`;
- aplicación: `Cohens Cafe Operations`;
- servicio: `cohens-cafe-operations`;
- moneda: MXN;
- zona horaria: `America/Mexico_City`;
- idioma: español;
- POS pública: `/cafe-pos`;
- IVA incluido: `CAFE_TAX_RATE_BPS=1600`, sujeto a validación contable.

## Catálogo

La pantalla `Cohen's Cafe` del administrador crea el menú de forma idempotente,
la colección automática y publica los nueve productos activos en Point of Sale
y Tienda online. Americano, capuchino, tamal de hoja de maíz y quesadilla se
conservan como borradores hasta confirmar precio y costo.

El inventario es híbrido:

- tamales, pan dulce y rebanadas de pastel controlan existencias;
- bebidas y platillos preparados no controlan producto terminado;
- los artículos controlados comienzan sin existencias vendibles y requieren una
  entrada real antes de aparecer disponibles en la POS.

## Puesta en marcha

1. Crear la tienda y conservarla en prueba.
2. Crear una aplicación Shopify distinta usando
   `shopify.app.cafe.example.toml` como plantilla.
3. Instalar Cohens Operations para la cafetería apuntando al mismo backend
   central del programa Nekudot.
4. Mantener una sola réplica mientras la base central sea SQLite; migrar a
   PostgreSQL antes de separar o escalar servicios.
5. Configurar credenciales exclusivas, `CAFE_POS_ENABLED=true`,
   `CAFE_SHOP_DOMAIN` y `CAFE_LOCATION_NAME`.
6. Instalar la aplicación únicamente en la tienda de cafetería.
7. Abrir `Apps > Cohens Cafe Operations > Cohen's Cafe` y ejecutar, en orden:
   crear/completar menú, cargar imágenes y restringir catálogo.
8. Abrir `Cafetería · POS web` y crear los PIN individuales.
9. Capturar existencias iniciales de los productos controlados.
10. Abrir `/cafe-pos` en Chrome Android, iniciar turno y autorizar la POS58D.

## POS e impresión

La POS crea primero una venta local con llave idempotente y después el pedido en
Shopify. Las ventas que pierdan conexión quedan como `PENDING_SYNC`; deben
reintentarse desde Pedidos sin volver a cobrar. Los pedidos sincronizados
descuentan inventario obedeciendo la política de Shopify.

La impresora usa WebUSB y comandos ESC/POS para papel de 58 mm. La primera
conexión siempre requiere autorización visible de Chrome. El ticket avanza el
papel para corte manual y no envía una orden de cortador.

## Configuración online

- recogida gratuita en la dirección de la cafetería;
- entrega local hasta 5 km;
- pedido mínimo: $200 MXN;
- tarifa: $50 MXN;
- entrega gratuita desde $500 MXN;
- Shopify Payments para checkout online;
- efectivo y terminal bancaria externa para la POS física.

Shopify Payments, facturación, datos fiscales, cuenta bancaria, políticas y
dominio requieren revisión directa del propietario antes de publicar.

## Corte desde `main`

La operación existente permanece activa durante las pruebas. Después de una
jornada piloto conciliada se despublican los productos `cohens-cafe` y se
desactiva la ubicación anterior en `main`. No se eliminan productos, pedidos ni
historial.
