ALTER TABLE public.products
  ADD COLUMN description TEXT,
  ADD COLUMN shopify_id TEXT;

ALTER TABLE public.products ALTER COLUMN source_url TYPE TEXT;