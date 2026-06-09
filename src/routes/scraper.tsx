import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { scrapeUrl, type ScrapedItem } from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Download } from "lucide-react";

export const Route = createFileRoute("/scraper")({
  head: () => ({ meta: [{ title: "URL Scraper · Cooling Parts Supply" }] }),
  component: ScraperPage,
});

const STRATEGY_LABELS: Record<string, string> = {
  partstown: "PartsTown",
  supplyhouse: "SupplyHouse",
  grainger: "Grainger",
  johnsoncontrols: "Johnson Controls",
  "next.js": "Next.js",
  "initial-state": "Initial State",
  generic: "Generic",
};

function StrategyBadge({ strategy }: { strategy: string }) {
  const label = STRATEGY_LABELS[strategy] ?? strategy;
  const colors: Record<string, string> = {
    partstown: "bg-blue-100 text-blue-800",
    supplyhouse: "bg-green-100 text-green-800",
    grainger: "bg-red-100 text-red-800",
    johnsoncontrols: "bg-purple-100 text-purple-800",
  };
  const cls = colors[strategy] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function ScraperPage() {
  const [url, setUrl] = useState("");
  const [results, setResults] = useState<ScrapedItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<{ strategy: string; pagesVisited: number } | null>(null);
  const scrapeFn = useServerFn(scrapeUrl);
  const qc = useQueryClient();

  const scrape = useMutation({
    mutationFn: async () => scrapeFn({ data: { url } }),
    onSuccess: (res) => {
      setResults(res.items);
      setSelected(new Set(res.items.map((i) => i.sku)));
      setMeta({ strategy: res.strategy, pagesVisited: res.pagesVisited });
      if (res.error) toast.warning(res.error);
      else toast.success(`Found ${res.items.length} product(s) via ${res.strategy}`);
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
          brand: r.brand ?? null,
          ebay_price: r.price,
          our_price: Number((r.price * 2).toFixed(2)),
          image_url: r.image,
          source_url: r.source,
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

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === results.length ? new Set() : new Set(results.map((r) => r.sku)),
    );
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
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle>Results ({results.length})</CardTitle>
              {meta && (
                <>
                  <StrategyBadge strategy={meta.strategy} />
                  <Badge variant="outline" className="text-xs font-normal">
                    {meta.pagesVisited} page{meta.pagesVisited !== 1 ? "s" : ""} visited
                  </Badge>
                </>
              )}
            </div>
            <Button
              onClick={() => importSelected.mutate()}
              disabled={importSelected.isPending || selected.size === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Import {selected.size} selected
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selected.size === results.length && results.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead className="w-16">Img</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Brand</TableHead>
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
                      <TableCell className="max-w-xs truncate">{r.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.brand ?? "—"}</TableCell>
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
