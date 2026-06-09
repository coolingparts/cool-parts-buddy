import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const scrapeInput = z.object({ url: z.string().url() });

type Scraped = {
  sku: string;
  title: string;
  price: number;
  image: string | null;
};

function extractScraped(html: string): Scraped[] {
  const results = new Map<string, Scraped>();

  // Try JSON-LD Product blocks first
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = ldRegex.exec(html))) {
    try {
      const json = JSON.parse(m[1].trim());
      const items = Array.isArray(json) ? json : json["@graph"] ?? [json];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const type = it["@type"];
        if (type !== "Product" && !(Array.isArray(type) && type.includes("Product"))) continue;
        const sku = String(it.sku ?? it.mpn ?? it.productID ?? it.gtin ?? it.name ?? "").trim();
        const title = String(it.name ?? "").trim();
        const offers = Array.isArray(it.offers) ? it.offers[0] : it.offers;
        const priceRaw = offers?.price ?? offers?.lowPrice ?? it.price ?? 0;
        const price = Number(String(priceRaw).replace(/[^0-9.]/g, "")) || 0;
        const image = Array.isArray(it.image) ? it.image[0] : it.image ?? null;
        if (sku && title) results.set(sku, { sku, title, price, image: image ?? null });
      }
    } catch { /* ignore */ }
  }

  if (results.size > 0) return Array.from(results.values());

  // Fallback: scan for product cards via simple heuristics
  const cardRegex =
    /data-sku=["']([^"']+)["'][\s\S]{0,800}?(?:alt=["']([^"']*)["'][\s\S]{0,400}?)?\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi;
  while ((m = cardRegex.exec(html))) {
    const sku = m[1].trim();
    const title = (m[2] || sku).trim();
    const price = Number(m[3]) || 0;
    if (!results.has(sku)) results.set(sku, { sku, title, price, image: null });
  }

  return Array.from(results.values());
}

export const scrapeUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => scrapeInput.parse(d))
  .handler(async ({ data }) => {
    const res = await fetch(data.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CoolingPartsBot/1.0; +https://coolingparts.local)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      return { items: [] as Scraped[], error: `Fetch failed: ${res.status}` };
    }
    const html = await res.text();
    const items = extractScraped(html);
    return { items, error: items.length === 0 ? "No products found on page" : null };
  });
