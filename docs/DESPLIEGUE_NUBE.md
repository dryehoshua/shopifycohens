# Despliegue en la nube de Cohens Operations

## Decisión inmediata

La primera versión productiva está desplegada en Railway como un servicio
Docker con dominio HTTPS permanente y reinicio automático. El despliegue
inicial usa el crédito Trial; antes de que venza se debe activar como mínimo
Hobby para conservar el servicio y el volumen.

Para reducir el riesgo del cambio, la base SQLite actual se conservará
inicialmente en un volumen persistente. El servicio tendrá una sola réplica
mientras utilice SQLite. La migración a PostgreSQL será la siguiente mejora de
infraestructura y permitirá escalar a múltiples réplicas.

## Datos que nunca se publican en GitHub

- Archivo `.env`.
- Credenciales y tokens de Shopify.
- Base `prisma/dev.sqlite`.
- Exportaciones de ventas, inventario o clientes.
- Registros de ejecución que puedan contener información operativa.

Estos archivos están excluidos tanto de Git como de la imagen Docker.

## Configuración de Railway

- Proyecto: `Cohens Operations`.
- Plan actual: Trial; siguiente mínimo operativo: Hobby.
- Repositorio previsto: `dryehoshua/shopifycohens`.
- Rama: `main`.
- Directorio raíz: `/apps/cohen-inventory-entry`.
- Constructor: Dockerfile.
- Dominio: `https://cohens-operations-production.up.railway.app`.
- Endpoint de salud: `/health`.
- Política de reinicio: siempre.
- Volumen persistente: montado en `/data`.
- Base de datos: `DATABASE_URL=file:/data/dev.sqlite`.
- Réplicas durante la etapa SQLite: una.

## Variables secretas requeridas

Los valores se cargarán directamente en Railway; no se copiarán al repositorio.

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `COHENS_SOURCE_SHOP`
- `COHENS_SOURCE_SHOP_NAME`
- `SHOPIFY_ADMIN_APP_URL`
- `NODE_ENV=production`

Railway proporciona `PORT` automáticamente.

## Migración y cambio de servicio

1. Proyecto y volumen creados en Railway.
2. Aplicación desplegada antes de dirigir Shopify al nuevo dominio.
3. Base SQLite transferida por SSH al volumen y validada por checksum.
4. `/health`, integridad, inventario, proveedores, movimientos y analíticos
   comprobados.
5. Dominio definitivo configurado en Shopify.
6. Versión `railway-production-2026-07-28` publicada.
7. Flujo de entrada y cálculos probados desde la tienda productiva sin registrar
   movimientos ficticios.
8. Túnel local retirado del flujo productivo.

## Verificación posterior

- La aplicación abre con la computadora local apagada.
- Los reinicios del contenedor no eliminan información.
- El inventario conserva nueve movimientos actuales y 46 proveedores.
- Los analíticos conservan 298 pedidos, 1,277 partidas y 23 reembolsos
  sincronizados.
- Los secretos no aparecen en el repositorio ni en los registros públicos.
- Railway muestra el servicio saludable y permite reiniciarlo automáticamente.
- El dominio público devuelve `{"status":"ok"}`.

## Segunda etapa

Migrar la base de datos a PostgreSQL administrado, configurar respaldos
periódicos, agregar monitoreo continuo externo y separar la sincronización de
ventas en un proceso programado.

Antes de vencer el Trial se debe activar Hobby. Pro queda reservado para una
etapa posterior si el negocio requiere equipos, mayor historial de registros o
un objetivo de disponibilidad superior.
