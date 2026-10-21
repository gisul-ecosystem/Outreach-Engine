"use client";

import { useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isSessionExpired } from "@/lib/client/api";

function makeQueryClient(onSessionExpired: (client: QueryClient) => void) {
  const onError = (err: unknown) => {
    if (isSessionExpired(err)) onSessionExpired(client);
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        // Don't retry when logged out; retry other failures once.
        retry: (failureCount, err) => !isSessionExpired(err) && failureCount < 1,
      },
    },
  });
  return client;
}

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  // One QueryClient per browser tab (useState keeps it across re-renders).
  const [queryClient] = useState(() => {
    let leaving = false; // many queries can fail at once — only handle the first
    return makeQueryClient((client) => {
      if (leaving) return;
      leaving = true;
      // The cookie can still hold a validly signed token for a user that no longer exists (e.g. after
      // switching databases). Clear it first, otherwise the proxy sends /login straight back to "/" in a loop.
      void fetch("/api/auth/logout", { method: "POST" })
        .catch(() => undefined)
        .finally(() => {
          client.clear();
          router.replace("/login");
          router.refresh();
          leaving = false;
        });
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
