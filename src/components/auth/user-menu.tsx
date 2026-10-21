"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type { AuthUser } from "@/shared/auth";

/** Signed-in user's email + Logout button, shown in the top bar. */
export function UserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => apiFetch<AuthUser>("/api/auth/me"),
  });

  const logout = useMutation({
    mutationFn: () => apiFetch<{ loggedOut: true }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear(); // forget all cached data from this session
      router.replace("/login");
      router.refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="ml-auto flex items-center gap-3">
      {me.isPending ? (
        <Skeleton className="h-4 w-40" />
      ) : (
        <span className="hidden text-sm text-muted-foreground sm:inline">{me.data?.email}</span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        <LogOutIcon />
        {logout.isPending ? "Logging out…" : "Logout"}
      </Button>
    </div>
  );
}
