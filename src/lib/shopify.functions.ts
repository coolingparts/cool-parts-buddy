import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// ── Supabase client (server-side only, uses process.env) ──────────────────────

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
  );
}

async function getStoredToken(): Promise<string | null> {
  const { data } = await getSupabase()
    .from("shopify_settings")
    .select("access_token")
    .eq("id", 1)
    .single();
  return data?.access_token ?? null;
}

// ── HMAC verification (Web Crypto — works in Node and edge runtimes) ──────────

async function verifyHmac(
  secret: string,
  params: Record<string, string>,
  receivedHmac: string,
): Promise<boolean> {
  const message = Object.entries(params)
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const digest = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return digest === receivedHmac;
}

// ── OAuth: gera URL de autorização ───────────────────────────────────────────

export const getShopifyAuthUrl = createServerFn({ method: "GET" }).handler(async () => {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI ?? "http://localhost:8081/shopify/callback";
  const shop = process.env.SHOPIFY_STORE ?? "coolingpartssupply.myshopify.com";

  if (!clientId) throw new Error("SHOPIFY_CLIENT_ID not configured");

  const url =
    `https://${shop}/admin/oauth/authorize?` +
    new URLSearchParams({
      client_id: clientId,
      scope: "write_products,read_products,write_inventory",
      redirect_uri: redirectUri,
      state: crypto.randomUUID(),
    }).toString();

  return { url };
});

// ── OAuth: troca code por access_token e salva no Supabase ───────────────────

const exchangeInput = z.object({
  code: z.string().min(1),
  hmac: z.string().min(1),
  shop: z.string().min(1),
  state: z.string(),
  timestamp: z.string(),
});

export const exchangeShopifyCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => exchangeInput.parse(d))
  .handler(
    async ({ data }): Promise<{ success: true } | { success: false; error: string }> => {
      const clientId = process.env.SHOPIFY_CLIENT_ID;
      const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return { success: false, error: "Shopify OAuth credentials not configured." };
      }

      const valid = await verifyHmac(
        clientSecret,
        { code: data.code, shop: data.shop, state: data.state, timestamp: data.timestamp },
        data.hmac,
      );
      if (!valid) {
        return { success: false, error: "HMAC inválido — possível request forjado." };
      }

      const tokenRes = await fetch(`https://${data.shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: data.code }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        return { success: false, error: `Token exchange falhou: ${tokenRes.status} ${text}` };
      }

      const json = (await tokenRes.json()) as { access_token: string; scope: string };

      const { error } = await getSupabase().from("shopify_settings").upsert({
        id: 1,
        shop: data.shop,
        access_token: json.access_token,
        scope: json.scope,
        updated_at: new Date().toISOString(),
      });

      if (error) return { success: false, error: `Falha ao salvar token: ${error.message}` };

      return { success: true };
    },
  );

// ── Publicar produto na Shopify (Admin GraphQL API 2025-01) ──────────────────
// Fluxo em 2 passos: productCreate (sem variants) → productVariantsBulkUpdate
// (SKU fica em inventoryItem.sku, price é campo direto da variante)

const PRODUCT_CREATE_MUTATION = `
  mutation productCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        handle
        variants(first: 1) {
          edges { node { id } }
        }
      }
      userErrors { field message }
    }
  }
`;

const VARIANT_UPDATE_MUTATION = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price sku }
      userErrors { field message }
    }
  }
`;

async function shopifyGraphQL<T>(
  store: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: T; errors?: { message: string }[] }> {
  const res = await fetch(`https://${store}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ data?: T; errors?: { message: string }[] }>;
}

const publishInput = z.object({
  title: z.string().min(1),
  sku: z.string().min(1),
  price: z.number().positive(),
  imageUrl: z.string().url().optional(),
  description: z.string().optional(),
});

export type PublishInput = z.infer<typeof publishInput>;

export type PublishResult =
  | { success: true; productId: number; productUrl: string }
  | { success: false; error: string };

export const publishToShopify = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => publishInput.parse(d))
  .handler(async ({ data }): Promise<PublishResult> => {
    const store = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_TOKEN ?? (await getStoredToken());

    if (!store) return { success: false, error: "SHOPIFY_STORE não configurado." };
    if (!token) {
      return {
        success: false,
        error: "Nenhum token Shopify configurado. Adicione SHOPIFY_TOKEN no .env ou conecte via OAuth.",
      };
    }

    // Passo 1: cria o produto (sem variants)
    type CreateData = {
      productCreate?: {
        product?: { id: string; handle: string; variants: { edges: { node: { id: string } }[] } };
        userErrors?: { field: string[]; message: string }[];
      };
    };

    let createResult: { data?: CreateData; errors?: { message: string }[] };
    try {
      createResult = await shopifyGraphQL<CreateData>(store, token, PRODUCT_CREATE_MUTATION, {
        product: {
          title: data.title,
          status: "ACTIVE",
          ...(data.description ? { descriptionHtml: data.description } : {}),
        },
      });
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }

    if (createResult.errors?.length) {
      return { success: false, error: createResult.errors.map((e) => e.message).join(", ") };
    }

    const createErrors = createResult.data?.productCreate?.userErrors ?? [];
    if (createErrors.length) {
      return { success: false, error: createErrors.map((e) => e.message).join(", ") };
    }

    const product = createResult.data?.productCreate?.product;
    if (!product) return { success: false, error: "Resposta inesperada da Shopify (productCreate)." };

    const variantId = product.variants.edges[0]?.node?.id;
    if (!variantId) return { success: false, error: "Variante padrão não encontrada." };

    // Passo 2: atualiza variante padrão com preço e SKU
    type UpdateData = {
      productVariantsBulkUpdate?: {
        productVariants?: { id: string; price: string; sku: string }[];
        userErrors?: { field: string[]; message: string }[];
      };
    };

    try {
      const updateResult = await shopifyGraphQL<UpdateData>(store, token, VARIANT_UPDATE_MUTATION, {
        productId: product.id,
        variants: [{ id: variantId, price: data.price.toFixed(2), inventoryItem: { sku: data.sku } }],
      });

      const updateErrors = updateResult.data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (updateErrors.length) {
        return { success: false, error: `Produto criado mas variante falhou: ${updateErrors.map((e) => e.message).join(", ")}` };
      }
    } catch (e) {
      return { success: false, error: `Produto criado mas variante falhou: ${(e as Error).message}` };
    }

    const numericId = Number(product.id.split("/").pop());

    return {
      success: true,
      productId: numericId,
      productUrl: `https://${store}/products/${product.handle}`,
    };
  });
