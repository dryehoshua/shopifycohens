import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/AccountPage.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.page.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.page.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/ProfileBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.profile.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/OrderStatusBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-status.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/CheckoutBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/ThankYouBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.thank-you.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared.jsx' {
  const shopify:
    | import('@shopify/ui-extensions/customer-account.profile.block.render').Api
    | import('@shopify/ui-extensions/customer-account.order-status.block.render').Api
    | import('@shopify/ui-extensions/purchase.checkout.block.render').Api
    | import('@shopify/ui-extensions/purchase.thank-you.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
