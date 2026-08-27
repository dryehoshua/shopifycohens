import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    cafeDedicated: process.env.CAFE_POS_ENABLED === "true" && session.shop === process.env.CAFE_SHOP_DOMAIN?.trim().toLowerCase(),
  };
};

export default function App() {
  const { apiKey, cafeDedicated } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ui-nav-menu>
        <a href="/app" rel="home">
          Inicio
        </a>
        <a href="/app/receive">Inventario · Registrar entrada</a>
        <a href="/app/profit">Analíticos · Utilidad</a>
        <a href="/app/cashback">Clientes · Nekudot</a>
        <a href="/app/cafe">Cohen&apos;s Cafe</a>
        {cafeDedicated ? <a href="/app/cafe-pos">Cafetería · POS web</a> : null}
      </ui-nav-menu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
