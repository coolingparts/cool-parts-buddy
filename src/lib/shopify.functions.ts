import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
    const token = process.env.SHOPIFY_TOKEN;

    if (!store || !token) {
      return { success: false, error: "Shopify credentials not configured." };
    }

    const body = {
      product: {
        title: data.title,
        body_html: data.description ?? "",
        status: "active",
        variants: [
          {
            sku: data.sku,
            price: data.price.toFixed(2),
            inventory_management: "shopify",
          },
        ],
        ...(data.imageUrl
          ? { images: [{ src: data.imageUrl }] }
          : {}),
      },
    };

    const res = await fetch(
      `https://${store}/admin/api/2024-01/products.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { success: false, error: `Shopify API error ${res.status}: ${text}` };
    }

    const json = (await res.json()) as { product: { id: number; handle: string } };
    const product = json.product;

    return {
      success: true,
      productId: product.id,
      productUrl: `https://${store}/products/${product.handle}`,
    };
  });
