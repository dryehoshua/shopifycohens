import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => render(<Tile />, document.body);

function Tile() {
  return (
    <s-tile
      heading="Nekudot Cohen's"
      subheading="Tarjeta, saldo y canje"
      tone="accent"
      onClick={() => shopify.action.presentModal()}
    />
  );
}
