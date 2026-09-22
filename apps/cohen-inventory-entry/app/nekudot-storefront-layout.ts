// Keep the account shortcut inside the Shopify header on narrow portal pages.
export const NEKUDOT_STOREFRONT_LAYOUT = `
  @media (max-width: 749px) {
    .header__nekudot-link { max-width: min(42vw, 170px); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1; }
    .header__icons { min-width: 0; }
  }
`;
