# Cohens Operations

Aplicación modular para centralizar operaciones de tienda sobre Shopify. El
repositorio contiene el análisis funcional público y el código de la aplicación,
sin credenciales, sesiones, datos de clientes, catálogo real ni cifras comerciales.

## Apartados activos

1. **Inventario y entradas**
   - recepción por código de barras desde PC y Shopify POS;
   - catálogo seleccionable de proveedores;
   - actualización incremental de existencias;
   - bitácora con fecha, usuario, ubicación y saldos;
   - correcciones compensatorias que no borran el movimiento original.
2. **Analíticos de utilidad**
   - sincronización de pedidos y reembolsos;
   - venta neta, costo vigente, utilidad bruta y margen;
   - cobertura de costos faltantes;
   - filtros rápidos y rango personalizado de fechas;
   - ordenamiento tipo Excel desde cada columna.

## Estructura

- `apps/cohen-inventory-entry/`: aplicación Shopify React Router, Prisma y
  extensión Shopify POS.
- `docs/ANALISIS_Y_PLAN.md`: objetivos, diagnóstico funcional y etapas.
- `docs/MODULO_1_INVENTARIO.md`: diseño y operación de inventario.
- `docs/MODULO_2_UTILIDAD.md`: fórmula, reembolsos y panel analítico.
- `knowledge-base/`: procedimientos y capacidades nativas de Shopify.

## Principios

- Shopify mantiene el saldo oficial de inventario.
- La base externa conserva auditoría y analítica, no un saldo paralelo.
- Un reembolso se descuenta una sola vez.
- Una corrección genera otro movimiento; nunca elimina evidencia.
- Las credenciales y los datos comerciales se guardan fuera de Git.

## Desarrollo local

```bash
cd apps/cohen-inventory-entry
cp .env.example .env
pnpm install
pnpm prisma migrate deploy
pnpm typecheck
pnpm build
```

Copiar `shopify.app.example.toml` como `shopify.app.toml` y completar la
configuración local antes de iniciar Shopify CLI.

## Estado

Los dos módulos descritos están implementados. Antes de una operación permanente
se requiere alojamiento HTTPS estable, una base de datos administrada, respaldos y
la configuración de permisos mínimos por ambiente.
