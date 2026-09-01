import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => render(<PostPurchaseBlock />, document.body);

function PostPurchaseBlock() {
  return (
    <s-pos-block heading="Nekudot Cohen's">
      <s-stack direction="block" gap="small">
        <s-text>¿El cliente tiene tarjeta Cohen&apos;s?</s-text>
        <s-button variant="primary" onClick={() => shopify.action.presentModal()}>
          Sí, escanear y acreditar según tarjeta
        </s-button>
        <s-text color="subdued">Si no tiene tarjeta, termina la venta normalmente.</s-text>
      </s-stack>
    </s-pos-block>
  );
}
