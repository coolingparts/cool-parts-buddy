import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
];

export type ScrapedItem = {
  sku: string;
  title: string;
  price: number;
  image: string | null;
  brand: string | null;
  source: string;
};

export type ScrapeResult = {
  items: ScrapedItem[];
  error: string | null;
  pagesVisited: number;
  strategy: string;
};

const scrapeInput = z.object({ url: z.string().url() });

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function jitter(base: number) {
  return base + Math.floor(Math.random() * base);
}

async function fetchHtml(url: string, attempt = 0): Promise<string> {
  if (attempt > 0) await sleep(jitter(800 * attempt));

  const beeKey = process.env.SCRAPINGBEE_KEY;
  const fetchUrl = beeKey
    ? `https://app.scrapingbee.com/api/v1/?api_key=${beeKey}&url=${encodeURIComponent(url)}&render_js=true`
    : url;

  const headers: Record<string, string> = beeKey
    ? {}
    : {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Referer: "https://www.google.com/",
      };

  const res = await fetch(fetchUrl, { headers });

  if ((res.status === 429 || res.status === 403) && attempt < 2) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
    await sleep(retryAfter > 0 ? retryAfter * 1000 : jitter(3000));
    return fetchHtml(url, attempt + 1);
  }

  if (!res.ok) {
    if (attempt < 2) return fetchHtml(url, attempt + 1);
    throw new Error(`HTTP ${res.status}`);
  }

  return res.text();
}

// ─── Shared extractors ────────────────────────────────────────────────────────

function extractJsonLd(html: string, source: string): ScrapedItem[] {
  const results = new Map<string, ScrapedItem>();
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const doc = JSON.parse(m[1].trim());
      const nodes: unknown[] = Array.isArray(doc)
        ? doc
        : doc["@graph"]
          ? (doc["@graph"] as unknown[])
          : [doc];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const n = node as Record<string, unknown>;
        const type = n["@type"];
        if (type !== "Product" && !(Array.isArray(type) && type.includes("Product"))) continue;
        const sku = String(n.sku ?? n.mpn ?? n.productID ?? "").trim();
        const title = String(n.name ?? "").trim();
        if (!sku || !title) continue;
        const offers = Array.isArray(n.offers) ? n.offers[0] : n.offers;
        const priceRaw = (offers as Record<string, unknown>)?.price ??
          (offers as Record<string, unknown>)?.lowPrice ?? 0;
        const price = Number(String(priceRaw).replace(/[^0-9.]/g, "")) || 0;
        const imgRaw = n.image;
        const image = Array.isArray(imgRaw) ? String(imgRaw[0]) : imgRaw ? String(imgRaw) : null;
        const brandRaw = n.brand;
        const brand =
          typeof brandRaw === "string"
            ? brandRaw || null
            : brandRaw && typeof brandRaw === "object"
              ? String((brandRaw as Record<string, unknown>).name ?? "") || null
              : null;
        results.set(sku, { sku, title, price, image, brand, source });
      }
    } catch { /* ignore */ }
  }
  return Array.from(results.values());
}

function extractOgMeta(html: string, source: string): ScrapedItem[] {
  const get = (prop: string) =>
    new RegExp(`property=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i").exec(html)?.[1]?.trim() ??
    new RegExp(`content=["']([^"']+)["'][^>]*property=["']${prop}["']`, "i").exec(html)?.[1]?.trim();

  const title = get("og:title");
  if (!title) return [];
  const image = get("og:image") ?? null;
  const priceStr = get("product:price:amount") ?? "0";
  const price = Number(priceStr.replace(/[^0-9.]/g, "")) || 0;
  const skuMeta = /name=["']sku["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]?.trim();
  const sku = skuMeta ?? title.slice(0, 40).replace(/\s+/g, "-");
  return [{ sku, title, price, image, brand: null, source }];
}

// ─── Walk helper for JSON state blobs ─────────────────────────────────────────

type ObjAny = Record<string, unknown>;

function walkJson(
  node: unknown,
  collect: (obj: ObjAny) => boolean,
  depth = 0,
): void {
  if (depth > 12 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkJson(child, collect, depth + 1);
    return;
  }
  const obj = node as ObjAny;
  if (!collect(obj)) {
    for (const val of Object.values(obj)) walkJson(val, collect, depth + 1);
  }
}

function pluckItem(obj: ObjAny, source: string): ScrapedItem | null {
  const sku = String(obj.sku ?? obj.partNumber ?? obj.itemNumber ?? obj.part_number ?? "").trim();
  const title = String(obj.name ?? obj.title ?? obj.displayName ?? obj.description ?? "").trim();
  if (!sku || !title || sku.length > 60 || title.length < 3) return null;
  const priceRaw = obj.price ?? obj.listPrice ?? obj.salePrice ?? obj.retailPrice ?? obj.unitPrice ?? 0;
  const price = Number(String(priceRaw).replace(/[^0-9.]/g, "")) || 0;
  const imgRaw = obj.image ?? obj.imageUrl ?? obj.thumbnail;
  const image =
    typeof imgRaw === "string"
      ? imgRaw
      : Array.isArray(imgRaw)
        ? String(imgRaw[0])
        : null;
  const brandRaw = obj.brand ?? obj.brandName ?? obj.manufacturer;
  const brand =
    typeof brandRaw === "string"
      ? brandRaw || null
      : brandRaw && typeof brandRaw === "object"
        ? String((brandRaw as ObjAny).name ?? "") || null
        : null;
  return { sku, title, price, image, brand, source };
}

// ─── Strategy: PartsTown (paginate 5p, data-part-number + JSON-LD) ───────────

async function scrapePartsTown(startUrl: string): Promise<{ items: ScrapedItem[]; pagesVisited: number }> {
  const all = new Map<string, ScrapedItem>();
  let pagesVisited = 0;

  for (let page = 1; page <= 5; page++) {
    const pageUrl = new URL(startUrl);
    if (page > 1) pageUrl.searchParams.set("page", String(page));

    let html: string;
    try { html = await fetchHtml(pageUrl.toString()); } catch { break; }
    pagesVisited++;

    for (const item of extractJsonLd(html, pageUrl.toString())) all.set(item.sku, item);

    const re = /data-part-number=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const sku = m[1].trim();
      if (all.has(sku)) continue;
      const chunk = html.slice(Math.max(0, m.index - 300), m.index + 1500);
      const titleM = /(?:data-description|data-name|data-product-name|alt)=["']([^"']{5,200})["']/i.exec(chunk);
      const priceM = /\$\s*([0-9,]+(?:\.[0-9]{1,2})?)/i.exec(chunk);
      const imgM = /src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)/i.exec(chunk);
      const brandM = /data-brand=["']([^"']+)["']/i.exec(chunk);
      if (titleM || priceM) {
        all.set(sku, {
          sku,
          title: titleM?.[1]?.trim() ?? sku,
          price: priceM ? Number(priceM[1].replace(/,/g, "")) : 0,
          image: imgM?.[1] ?? null,
          brand: brandM?.[1]?.trim() ?? null,
          source: pageUrl.toString(),
        });
      }
    }

    if (page === 1 && all.size === 0) break;
    const hasNext = new RegExp(`[?&]page=${page + 1}|rel=["']next["']`, "i").test(html);
    if (!hasNext) break;
    await sleep(jitter(900));
  }

  return { items: Array.from(all.values()), pagesVisited };
}

// ─── Strategy: SupplyHouse (__NEXT_DATA__) ────────────────────────────────────

function scrapeNextData(html: string, source: string): ScrapedItem[] {
  const m =
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html) ??
    /<script[^>]*type=["']application\/json["'][^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return [];

  const results = new Map<string, ScrapedItem>();
  try {
    const data = JSON.parse(m[1]);
    walkJson(data.props ?? data, (obj) => {
      const item = pluckItem(obj, source);
      if (item) { results.set(item.sku, item); return true; }
      return false;
    });
  } catch { /* ignore */ }
  return Array.from(results.values());
}

// ─── Strategy: Grainger ("products":[] in scripts) ────────────────────────────

function scrapeGrainger(html: string, source: string): ScrapedItem[] {
  console.log("[grainger] html preview:\n", html.slice(0, 3000));

  const results = new Map<string, ScrapedItem>();
  let m: RegExpExecArray | null;

  // 1. "products":[] arrays
  const productsRe = /"products"\s*:\s*(\[[\s\S]*?\])/g;
  while ((m = productsRe.exec(html))) {
    try {
      const arr = JSON.parse(m[1]);
      if (!Array.isArray(arr)) continue;
      for (const p of arr) {
        const item = pluckItem(p as ObjAny, source);
        if (item) results.set(item.sku, item);
      }
    } catch { /* ignore */ }
  }

  // 2. window.__PRELOADED_STATE__
  const preloadedM = /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*(?:<\/script>|[a-z])/i.exec(html);
  if (preloadedM) {
    try {
      const state = JSON.parse(preloadedM[1]);
      walkJson(state, (obj) => {
        const item = pluckItem(obj, source);
        if (item) { results.set(item.sku, item); return true; }
        return false;
      });
    } catch { /* ignore */ }
  }

  // 3. window.dataLayer — find objects with a products array
  const dataLayerRe = /window\.dataLayer\s*=\s*(\[[\s\S]*?\]);\s*(?:<\/script>|[a-z])/i.exec(html);
  if (dataLayerRe) {
    try {
      const layer = JSON.parse(dataLayerRe[1]);
      if (Array.isArray(layer)) {
        for (const entry of layer) {
          const ecom = (entry as ObjAny)?.ecommerce as ObjAny | undefined;
          const prods = (ecom?.detail as ObjAny)?.products
            ?? ecom?.impressions
            ?? ecom?.items
            ?? (entry as ObjAny)?.products;
          if (!Array.isArray(prods)) continue;
          for (const p of prods) {
            const item = pluckItem(p as ObjAny, source);
            if (item) results.set(item.sku, item);
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 4. Any JSON blob containing "itemNumber" or "partNumber"
  const blobRe = /(\{[^{}]*(?:"itemNumber"|"partNumber")[^{}]*\})/g;
  while ((m = blobRe.exec(html))) {
    try {
      const obj = JSON.parse(m[1]);
      const item = pluckItem(obj as ObjAny, source);
      if (item && !results.has(item.sku)) results.set(item.sku, item);
    } catch { /* ignore */ }
  }

  // 5. JSON-LD fallback
  for (const item of extractJsonLd(html, source)) {
    if (!results.has(item.sku)) results.set(item.sku, item);
  }

  console.log(`[grainger] found ${results.size} items`);
  return Array.from(results.values());
}

// ─── Strategy: JohnsonControls (window.__INITIAL_STATE__) ────────────────────

function scrapeInitialState(html: string, source: string): ScrapedItem[] {
  const m = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*(?:<\/script>|[a-z])/i.exec(html);
  if (!m) return [];

  const results = new Map<string, ScrapedItem>();
  try {
    const state = JSON.parse(m[1]);
    walkJson(state, (obj) => {
      const item = pluckItem(obj, source);
      if (item) { results.set(item.sku, item); return true; }
      return false;
    });
  } catch { /* ignore */ }
  return Array.from(results.values());
}

// ─── Generic fallback (JSON-LD → data-sku → OG meta) ─────────────────────────

function scrapeGeneric(html: string, source: string): ScrapedItem[] {
  const ldItems = extractJsonLd(html, source);
  if (ldItems.length > 0) return ldItems;

  const results = new Map<string, ScrapedItem>();
  const re = /data-sku=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const sku = m[1].trim();
    if (results.has(sku)) continue;
    const chunk = html.slice(Math.max(0, m.index - 300), m.index + 1500);
    const titleM = /(?:data-name|data-title|data-product-name|alt|title)=["']([^"']{5,200})["']/i.exec(chunk);
    const priceM = /\$\s*([0-9,]+(?:\.[0-9]{1,2})?)/i.exec(chunk);
    const imgM = /src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)/i.exec(chunk);
    const brandM = /data-brand=["']([^"']+)["']/i.exec(chunk);
    results.set(sku, {
      sku,
      title: titleM?.[1]?.trim() ?? sku,
      price: priceM ? Number(priceM[1].replace(/,/g, "")) : 0,
      image: imgM?.[1] ?? null,
      brand: brandM?.[1]?.trim() ?? null,
      source,
    });
  }
  if (results.size > 0) return Array.from(results.values());

  return extractOgMeta(html, source);
}

// ─── Strategy: Sitemap (.xml.gz with categoryproductlisting) ─────────────────

async function decompressGz(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": randomUA(), Accept: "application/gzip, */*" },
  });
  if (!res.ok) throw new Error(`Sitemap gz fetch failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { gunzipSync } = await import("node:zlib");
  return gunzipSync(buf).toString("utf-8");
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function scrapeSitemap(
  indexUrl: string,
): Promise<{ items: ScrapedItem[]; pagesVisited: number }> {
  let pagesVisited = 0;

  // 1. Fetch the sitemap index XML
  const indexXml = await fetchHtml(indexUrl);
  pagesVisited++;

  // 2. Collect ALL <loc> containing "models-com" (models-com-0.xml.gz, models-com-1.xml.gz, …)
  const locRe = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi;
  const modelLocs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = locRe.exec(indexXml))) {
    if (m[1].includes("models-com")) modelLocs.push(m[1].trim());
  }

  if (modelLocs.length === 0) return { items: [], pagesVisited };

  // 3. Fetch and decompress up to 3 files
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();

  for (const gzUrl of modelLocs.slice(0, 3)) {
    let xml: string;
    try {
      xml = await decompressGz(gzUrl);
    } catch { continue; }
    pagesVisited++;

    // 4. Extract <loc> URLs — individual part/model pages
    const itemLocRe = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi;
    while ((m = itemLocRe.exec(xml)) && items.length < 500) {
      const locUrl = m[1].trim();

      // 5. Parse SKU: last path segment, strip query strings
      const rawSlug = locUrl.split("?")[0].split("/").filter(Boolean).pop() ?? "";
      if (!rawSlug || rawSlug.includes(".xml") || rawSlug.includes(".gz")) continue;
      if (seen.has(rawSlug)) continue;
      seen.add(rawSlug);

      // 6. Title: slug → title case
      const title = slugToTitle(rawSlug);
      items.push({ sku: rawSlug, title, price: 0, image: null, brand: null, source: locUrl });
    }

    if (items.length >= 500) break;
    await sleep(jitter(400));
  }

  return { items, pagesVisited };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export const scrapeUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => scrapeInput.parse(d))
  .handler(async ({ data }): Promise<ScrapeResult> => {
    let hostname: string;
    try {
      hostname = new URL(data.url).hostname.replace(/^www\./, "");
    } catch {
      return { items: [], error: "Invalid URL", pagesVisited: 0, strategy: "none" };
    }

    let items: ScrapedItem[] = [];
    let pagesVisited = 0;
    let strategy = "generic";

    try {
      if (data.url.includes("sitemap") && data.url.includes(".xml")) {
        strategy = "sitemap";
        const r = await scrapeSitemap(data.url);
        items = r.items;
        pagesVisited = r.pagesVisited;
      } else if (hostname.includes("partstown.com")) {
        strategy = "partstown";
        const r = await scrapePartsTown(data.url);
        items = r.items;
        pagesVisited = r.pagesVisited;
      } else {
        const html = await fetchHtml(data.url);
        pagesVisited = 1;

        if (hostname.includes("supplyhouse.com") || /<script[^>]*id=["']__NEXT_DATA__/.test(html)) {
          strategy = hostname.includes("supplyhouse.com") ? "supplyhouse" : "next.js";
          items = scrapeNextData(html, data.url);
        } else if (hostname.includes("grainger.com")) {
          strategy = "grainger";
          items = scrapeGrainger(html, data.url);
        } else if (hostname.includes("johnsoncontrols.com") || /window\.__INITIAL_STATE__/.test(html)) {
          strategy = hostname.includes("johnsoncontrols.com") ? "johnsoncontrols" : "initial-state";
          items = scrapeInitialState(html, data.url);
        } else {
          items = scrapeGeneric(html, data.url);
        }

        if (items.length === 0) items = scrapeGeneric(html, data.url);
      }
    } catch (e) {
      return {
        items: [],
        error: (e as Error).message,
        pagesVisited,
        strategy,
      };
    }

    return {
      items,
      error: items.length === 0 ? "No products found on page" : null,
      pagesVisited,
      strategy,
    };
  });
