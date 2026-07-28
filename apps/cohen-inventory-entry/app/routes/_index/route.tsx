import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Cohens Operations</h1>
        <p className={styles.text}>
          Operación de inventario y analíticos de utilidad conectados con
          Shopify.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Inventario y entradas</strong>. Recepción por código de
            barras, proveedores, bitácora y correcciones sin borrar movimientos.
          </li>
          <li>
            <strong>Analíticos de utilidad</strong>. Venta neta, costo vigente,
            reembolsos, utilidad bruta y filtros por producto y fecha.
          </li>
          <li>
            <strong>Base modular</strong>. Preparada para agregar nuevas
            operaciones sin mezclar sus flujos ni permisos.
          </li>
        </ul>
      </div>
    </div>
  );
}
