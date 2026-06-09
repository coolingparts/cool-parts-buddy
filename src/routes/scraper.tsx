import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { scrapeUrl } from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Download } from "lucide-react";

export const Route = createFileRoute("/scraper")({
  head: () => ({ meta: [{ title: "URL Scraper · Cooling Parts Supply" }] }),
  component: ScraperPage,
});

type Scraped = { sku: string; title: string; price: number; image: string | null };

function ScraperPage() {
  const [url, setUrl] = useState("");
  const [results, setResults] = useState<Scraped[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const scrapeFn = useServerFn(scrapeUrl);
  const qc = useQueryClient();

  const scrape = useMutation({
    mutationFn: async () => scrapeFn({ data: { url } }),
    onSuccess: (res) => {
      setResults(res.items);
      setSelected(new Set(res.items.map((i) => i.sku)));
      if (res.error) toast.warning(res.error);
      else toast.success(`Found ${res.items.length} products`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importSelected = useMutation({
    mutationFn: async () => {
      const rows = results
        .filter((r) => selected.has(r.sku))
        .map((r) => ({
          sku: r.sku,
          title: r.title,
          ebay_price: r.price,
          our_price: Number((r.price * 2).toFixed(2)),
          image_url: r.image,
          source_url: url,
          status: "pending" as const,
        }));
      if (rows.length === 0) throw new Error("Select at least one row");
      const { error } = await supabase.from("products").upsert(rows, { onConflict: "sku" });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`Imported ${n} products`);
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (sku: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">URL Scraper</h1>
        <p className="text-sm text-muted-foreground">Extract SKUs, titles, prices, and images from a competitor URL.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Competitor URL</CardTitle></CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (url) scrape.mutate(); }}
          >
            <Input
              type="url" required placeholder="https://competitor.example.com/category"
              value={url} onChange={(e) => setUrl(e.target.value)}
            />
            <Button type="submit" disabled={scrape.isPending || !url}>
              {scrape.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scrape"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Results ({results.length})</CardTitle>
            <Button onClick={() => importSelected.mutate()} disabled={importSelected.isPending || selected.size === 0}>
              <Download className="mr-2 h-4 w-4" />
              Import {selected.size} selected
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="w-16">Img</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">eBay Price</TableHead>
                    <TableHead className="text-right">Our Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.sku}>
                      <TableCell>
                        <Checkbox checked={selected.has(r.sku)} onCheckedChange={() => toggle(r.sku)} />
                      </TableCell>
                      <TableCell>
                        {r.image ? (
                          <img src={r.image} alt={r.title} className="h-10 w-10 rounded object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded bg-muted" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className="max-w-md truncate">{r.title}</TableCell>
                      <TableCell className="text-right">${r.price.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium text-primary">
                        ${(r.price * 2).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
