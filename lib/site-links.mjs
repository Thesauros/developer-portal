export const marketingOrigin = (
  process.env.NEXT_PUBLIC_MARKETING_URL || "https://thesauros.io"
).replace(/\/+$/, "");
export const documentationOrigin = (
  process.env.NEXT_PUBLIC_DOCS_URL || "https://docs.thesauros.io"
).replace(/\/+$/, "");
export const marketingHref = (path = "/") => marketingOrigin + path;
export const documentationHref = (path = "/") => documentationOrigin + path;
