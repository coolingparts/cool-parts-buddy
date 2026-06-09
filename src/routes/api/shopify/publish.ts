import { createAPIFileRoute } from "@tanstack/react-start/api";
import { z } from "zod";

const publishSchema = z.object({
  title: z.string().min(1),
  sku: z.string().min(1),
  price: z.number().positive(),
  imageUrl: z.string().url().optional(),
  description: z.string().optional(),
});

export const APIRoute = createAPIFileRoute("/api/shopify/publish")({
  POST: async ({ request }) => {
    const store = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_TOKEN;

    if (!store || !token) {
      return Response.json(
        { success: false, error: "Shopify credentials not configured on the server." },
        { status: 500 },
      );
    }

    let input: z.infer<typeof publishSchema>;
    try {
      const raw = await request.json();
      input = publishSchema.parse(raw);
    } catch {
      return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
    }

    const shopifyBody = {
      product: {
        title: input.title,
        body_html: input.description ?? "",
        status: "active",
        variants: [
          {
            sku: input.sku,
            price: input.price.toFixed(2),
            inventory_management: "shopify",
          },
        ],
        ...(input.imageUrl ? { images: [{ src: input.imageUrl }] } : {}),
      },
    };

    const shopifyRes = await fetch(
      `https://${store}/admin/api/2025-01/products.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify(shopifyBody),
      },
    );

    if (!shopifyRes.ok) {
      const text = await shopifyRes.text().catch(() => shopifyRes.statusText);
      return Response.json(
        { success: false, error: `Shopify API error ${shopifyRes.status}: ${text}` },
        { status: 502 },
      );
    }

    const json = (await shopifyRes.json()) as { product: { id: number; handle: string } };
    const product = json.product;

    return Response.json({
      success: true,
      productId: product.id,
      productUrl: `https://${store}/products/${product.handle}`,
    });
  },
});
