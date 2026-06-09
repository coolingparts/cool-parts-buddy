import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, CheckCircle2, Clock, Rocket } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard · Cooling Parts Supply" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["product-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("status");
      if (error) throw error;
      const rows = data ?? [];
      return {
        total: rows.length,
        pending: rows.filter((r) => r.status === "pending").length,
        approved: rows.filter((r) => r.status === "approved").length,
        published: rows.filter((r) => r.status === "published").length,
      };
    },
  });

  const stats = [
    { label: "Total Scraped", value: data?.total ?? 0, icon: Package, color: "text-primary" },
    { label: "Pending", value: data?.pending ?? 0, icon: Clock, color: "text-warning" },
    { label: "Approved", value: data?.approved ?? 0, icon: CheckCircle2, color: "text-primary" },
    { label: "Published", value: data?.published ?? 0, icon: Rocket, color: "text-success" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your product pipeline.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{isLoading ? "—" : s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Scrape competitor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste a competitor URL to extract SKUs, titles, and prices in one click.
            </p>
            <Link to="/scraper" className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Open scraper
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Manual entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add a SKU by hand. eBay price doubles into your sell price automatically.
            </p>
            <Link to="/add" className="inline-flex items-center rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80">
              Add SKU
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
