ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url TEXT;
