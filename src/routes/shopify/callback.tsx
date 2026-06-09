import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { exchangeShopifyCode } from "@/lib/shopify.functions";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export const Route = createFileRoute("/shopify/callback")({
  validateSearch: (s: Record<string, unknown>) => {
    // Captura todos os params — Shopify inclui `host` e outros no HMAC
    const { hmac, code, shop, ...rest } = s;
    return {
      code: String(code ?? ""),
      hmac: String(hmac ?? ""),
      shop: String(shop ?? ""),
      // restante (state, timestamp, host, etc.) repassado como strings
      rest: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v ?? "")])),
    };
  },
  component: ShopifyCallback,
});

function ShopifyCallback() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const exchangeFn = useServerFn(exchangeShopifyCode);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!search.code) {
      setStatus("error");
      setErrorMsg("Nenhum código de autorização recebido do Shopify.");
      return;
    }

    exchangeFn({ data: { code: search.code, hmac: search.hmac, shop: search.shop, ...search.rest } })
      .then((result) => {
        if (result.success) {
          setStatus("success");
          toast.success("Shopify conectado com sucesso!");
          setTimeout(() => navigate({ to: "/products" }), 1800);
        } else {
          setStatus("error");
          setErrorMsg(result.error);
          toast.error(result.error);
        }
      })
      .catch((e: Error) => {
        setStatus("error");
        setErrorMsg(e.message);
        toast.error(e.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      {status === "loading" && (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Conectando à Shopify…</p>
        </>
      )}
      {status === "success" && (
        <>
          <CheckCircle2 className="h-8 w-8 text-green-500" />
          <p className="font-medium">Conectado! Redirecionando…</p>
        </>
      )}
      {status === "error" && (
        <>
          <XCircle className="h-8 w-8 text-destructive" />
          <p className="font-medium text-destructive">Falha na conexão</p>
          <p className="text-sm text-muted-foreground max-w-sm text-center">{errorMsg}</p>
        </>
      )}
    </div>
  );
}
