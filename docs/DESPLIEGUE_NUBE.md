# Despliegue en la nube de Cohens Operations

## Decisión inmediata

La primera versión productiva se desplegará en Railway Pro como un servicio
Docker con dominio HTTPS permanente y reinicio automático.

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

- Proyecto: `cohens-operations-production`.
- Plan: Pro.
- Repositorio: `dryehoshua/shopifycohens`.
- Rama: `main`.
- Directorio raíz: `/apps/cohen-inventory-entry`.
- Constructor: Dockerfile.
- Dominio: generado por Railway durante el primer despliegue.
- Endpoint de salud: `/health`.
- Política de reinicio: siempre.
- Volumen persistente: montado en `/app/prisma`.
- Réplicas durante la etapa SQLite: una.

## Variables secretas requeridas

Los valores se cargarán directamente en Railway; no se copiarán al repositorio.

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `COHENS_SOURCE_SHOP`
- `COHENS_SOURCE_SHOP_NAME`
- `COHENS_SOURCE_ADMIN_TOKEN`
- `SHOPIFY_ADMIN_APP_URL`
- `NODE_ENV=production`

Railway proporciona `PORT` automáticamente.

## Migración y cambio de servicio

1. Crear el proyecto y el volumen en Railway.
2. Desplegar la aplicación sin dirigir todavía Shopify al nuevo dominio.
3. Transferir la base SQLite por un canal seguro al volumen.
4. Comprobar `/health`, inventario, proveedores, movimientos y analíticos.
5. Configurar el dominio definitivo en Shopify.
6. Publicar la nueva configuración de la aplicación.
7. Probar el flujo de entrada y los cálculos desde la tienda productiva.
8. Mantener el servidor local disponible únicamente durante la validación.
9. Apagar el túnel local después de confirmar el servicio en la nube.

## Verificación posterior

- La aplicación abre con la computadora local apagada.
- Los reinicios del contenedor no eliminan información.
- El inventario conserva nueve movimientos actuales y 46 proveedores.
- Los analíticos conservan 298 pedidos, 1,277 partidas y 23 reembolsos
  sincronizados.
- Los secretos no aparecen en el repositorio ni en los registros públicos.
- Railway muestra el servicio saludable y permite reiniciarlo automáticamente.

## Segunda etapa

Migrar la base de datos a PostgreSQL administrado, configurar respaldos
periódicos, agregar monitoreo continuo externo y separar la sincronización de
ventas en un proceso programado.
