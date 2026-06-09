import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: T; errors?: { message: string }[] }> {
  const store = process.env.SHOPIFY_STORE;
  const token = process.env.SHOPIFY_TOKEN;

  if (!store || !token) throw new Error("SHOPIFY_STORE ou SHOPIFY_TOKEN não configurado no .env");

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
    // Passo 1: cria o produto
    type CreateData = {
      productCreate?: {
        product?: { id: string; handle: string; variants: { edges: { node: { id: string } }[] } };
        userErrors?: { field: string[]; message: string }[];
      };
    };

    let createResult: { data?: CreateData; errors?: { message: string }[] };
    try {
      createResult = await shopifyGraphQL<CreateData>(PRODUCT_CREATE_MUTATION, {
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

    // Passo 2: define preço e SKU na variante padrão
    type UpdateData = {
      productVariantsBulkUpdate?: {
        productVariants?: { id: string }[];
        userErrors?: { field: string[]; message: string }[];
      };
    };

    try {
      const updateResult = await shopifyGraphQL<UpdateData>(VARIANT_UPDATE_MUTATION, {
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

    return {
      success: true,
      productId: Number(product.id.split("/").pop()),
      productUrl: `https://${process.env.SHOPIFY_STORE}/products/${product.handle}`,
    };
  });
