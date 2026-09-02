export const NEKUDOT_ORIGIN = "https://cohens-operations-production.up.railway.app";
export const NEKUDOT_SOCIAL_IMAGE = `${NEKUDOT_ORIGIN}/og-nekudot.jpg`;

export function nekudotMeta(
  title: string,
  description: string,
  imagePath = "/og-nekudot.jpg",
  imageAlt = "Cohen's Nekudot: tu cashback rinde más",
) {
  const socialImage = `${NEKUDOT_ORIGIN}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`;
  return [
    { title },
    { name: "description", content: description },
    { name: "theme-color", content: "#061b35" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "es_MX" },
    { property: "og:site_name", content: "Cohen's · Nekudot" },
    { property: "og:image", content: socialImage },
    { property: "og:image:width", content: "1536" },
    { property: "og:image:height", content: "1024" },
    {
      property: "og:image:alt",
      content: imageAlt,
    },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: socialImage },
    { name: "twitter:image:alt", content: imageAlt },
  ];
}
