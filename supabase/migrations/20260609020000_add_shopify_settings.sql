CREATE TABLE IF NOT EXISTS public.shopify_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  shop TEXT NOT NULL DEFAULT 'coolingpartssupply.myshopify.com',
  access_token TEXT,
  scope TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shopify_settings_single_row CHECK (id = 1)
);

INSERT INTO public.shopify_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON public.shopify_settings TO anon, authenticated;
GRANT ALL ON public.shopify_settings TO service_role;

ALTER TABLE public.shopify_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on shopify_settings" ON public.shopify_settings FOR ALL USING (true) WITH CHECK (true);
