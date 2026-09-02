import type { LinksFunction, MetaFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { nekudotMeta } from "./nekudot-meta";

export const links: LinksFunction = () => [
  { rel: "icon", href: "/cohens-favicon.svg", type: "image/svg+xml" },
];

export const meta: MetaFunction = () =>
  nekudotMeta(
    "Cohen's · Nekudot",
    "Regístrate, lleva tu tarjeta digital y consulta los beneficios de tus compras Cohen's.",
  );

export default function App() {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
