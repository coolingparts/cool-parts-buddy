import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { publishToShopify } from "@/lib/shopify.functions";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, ExternalLink, Loader2, Rocket, Trash2, Pencil } from "lucide-react";

export const Route = createFileRoute("/products")({
  head: () => ({ meta: [{ title: "Products · Cooling Parts Supply" }] }),
  component: ProductsPage,
});

type Status = "pending" | "approved" | "published";
type Product = {
  id: string;
  sku: string;
  title: string;
  description: string | null;
  ebay_price: number;
  our_price: number;
  image_url: string | null;
  status: Status;
  shopify_id: string | null;
};

function statusBadge(s: Status) {
  if (s === "published") return <Badge className="bg-success text-success-foreground">Published</Badge>;
  if (s === "approved") return <Badge className="bg-primary text-primary-foreground">Approved</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

function ProductsPage() {
  const qc = useQueryClient();
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [publishing, setPublishing] = useState<string | null>(null);
  const publishFn = useServerFn(publishToShopify);

  const { data, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, sku, title, description, ebay_price, our_price, image_url, status, shopify_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Product[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await supabase.from("products").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(`Marked as ${vars.status}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateDescription = useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const { error } = await supabase.from("products").update({ description }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Description saved");
      qc.invalidateQueries({ queryKey: ["products"] });
      setEditProduct(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
    },
  });

  async function handlePublishToShopify(p: Product) {
    setPublishing(p.id);
    try {
      const result = await publishFn({
        data: {
          title: p.title,
          sku: p.sku,
          price: Number(p.our_price),
          imageUrl: p.image_url ?? undefined,
          description: p.description ?? undefined,
        },
      });

      if (!result.success) {
        toast.error(`Shopify error: ${result.error}`);
        return;
      }

      const { error } = await supabase
        .from("products")
        .update({ status: "published", shopify_id: String(result.productId) })
        .eq("id", p.id);

      if (error) {
        toast.error(`Published on Shopify but failed to save ID: ${error.message}`);
      } else {
        toast.success(
          <span>
            Published!{" "}
            <a href={result.productUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">
              View on Shopify
            </a>
          </span>,
          { duration: 6000 },
        );
      }

      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPublishing(null);
    }
  }

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setEditDesc(p.description ?? "");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="text-sm text-muted-foreground">Approve, publish, or remove items from your catalog.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Catalog ({data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Img</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">eBay</TableHead>
                  <TableHead className="text-right">Our Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                )}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No products yet. Scrape a URL or add one manually.</TableCell></TableRow>
                )}
                {data?.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.title} className="h-10 w-10 rounded object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="max-w-md truncate">{p.title}</TableCell>
                    <TableCell>
                      {p.description ? (
                        <span className="text-xs text-muted-foreground max-w-[200px] truncate block">{p.description}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">${Number(p.ebay_price).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium text-primary">${Number(p.our_price).toFixed(2)}</TableCell>
                    <TableCell>{statusBadge(p.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {p.status === "pending" && (
                          <Button size="sm" variant="secondary"
                            onClick={() => updateStatus.mutate({ id: p.id, status: "approved" })}>
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                          </Button>
                        )}
                        {p.status !== "published" && (
                          <Button
                            size="sm"
                            disabled={publishing === p.id}
                            onClick={() => handlePublishToShopify(p)}
                          >
                            {publishing === p.id ? (
                              <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Publishing…</>
                            ) : (
                              <><Rocket className="mr-1 h-3.5 w-3.5" /> Publish</>
                            )}
                          </Button>
                        )}
                        {p.status === "published" && p.shopify_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                          >
                            <a
                              href={`https://admin.shopify.com/store/coolingpartssupply/products/${p.shopify_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Shopify
                            </a>
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(p.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editProduct} onOpenChange={(open) => { if (!open) setEditProduct(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
          </DialogHeader>
          {editProduct && (
            <div className="space-y-4">
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">SKU</span>
                <span className="font-mono text-sm">{editProduct.sku}</span>
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">Title</span>
                <span className="text-sm">{editProduct.title}</span>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  rows={5}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Enter product description…"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditProduct(null)}>Cancel</Button>
                <Button
                  onClick={() => updateDescription.mutate({ id: editProduct.id, description: editDesc })}
                  disabled={updateDescription.isPending}
                >
                  {updateDescription.isPending ? "Saving…" : "Save Description"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
