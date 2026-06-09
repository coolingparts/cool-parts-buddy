import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/add")({
  head: () => ({ meta: [{ title: "Add SKU · Cooling Parts Supply" }] }),
  component: AddSku,
});

function AddSku() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    sku: "", title: "", brand: "", ebay_price: "", image_url: "", description: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      const ebay = Number(form.ebay_price) || 0;
      const { error } = await supabase.from("products").insert({
        sku: form.sku.trim(),
        title: form.title.trim(),
        brand: form.brand.trim() || null,
        description: form.description.trim() || null,
        ebay_price: ebay,
        our_price: Number((ebay * 2).toFixed(2)),
        image_url: form.image_url.trim() || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product added");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      navigate({ to: "/products" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ebay = Number(form.ebay_price) || 0;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add SKU</h1>
        <p className="text-sm text-muted-foreground">Manually enter a product. Your price is auto-set to 2× eBay.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Product details</CardTitle></CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
          >
            <div className="grid gap-2">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="CP-12345" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Radiator Cooling Fan Assembly" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="brand">Brand (optional)</Label>
              <Input id="brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="Denso, Spectra Premium…" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Product details, specs, fitment info…"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ebay">eBay Price ($)</Label>
                <Input id="ebay" type="number" step="0.01" min="0" required
                  value={form.ebay_price}
                  onChange={(e) => setForm({ ...form, ebay_price: e.target.value })}
                  placeholder="49.99" />
              </div>
              <div className="grid gap-2">
                <Label>Our Price (auto)</Label>
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-sm font-medium text-primary">
                  ${(ebay * 2).toFixed(2)}
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="image">Image URL (optional)</Label>
              <Input id="image" type="url" value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://…" />
            </div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add product"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
