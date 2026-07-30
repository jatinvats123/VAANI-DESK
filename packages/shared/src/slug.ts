import { randomBytes } from "node:crypto";

/** "Glow Salon & Spa, Andheri!" → "glow-salon-spa-andheri" */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Collision-resistant suffix for generated slugs: "glow-salon-x7k2". */
export function slugWithSuffix(input: string): string {
  const base = slugify(input) || "business";
  return `${base}-${randomBytes(2).toString("hex")}`;
}
