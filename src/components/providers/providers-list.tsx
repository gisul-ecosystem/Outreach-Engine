"use client";

import {
  MoreHorizontalIcon,
  PencilIcon,
  PlugZapIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/layout/empty-state";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorMessage } from "@/lib/client/api";
import { formatRelative } from "@/lib/client/format";
import { hasMailRead, type ProviderDTO } from "@/shared/provider";
import { ProviderFormDialog } from "./provider-form-dialog";
import { ProviderStatusBadge } from "./provider-status-badge";
import { SetupGuide } from "./setup-guide";
import { useDeleteProvider, useProviders, useVerifyProvider } from "./use-providers";

export function ProvidersList() {
  const providers = useProviders();
  const verify = useVerifyProvider();
  const remove = useDeleteProvider();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderDTO | null>(null);
  const [toDelete, setToDelete] = useState<ProviderDTO | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <SetupGuide />

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {providers.data ? `${providers.data.total} connection(s)` : " "}
        </p>
        <Button onClick={openAdd}>
          <PlusIcon />
          Add Microsoft 365 connection
        </Button>
      </div>

      {providers.isError ? (
        <div className="rounded-lg border border-destructive/30 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load connections</p>
          <p className="mt-1 text-muted-foreground">{errorMessage(providers.error)}</p>
        </div>
      ) : providers.data?.data.length === 0 ? (
        <EmptyState
          icon={PlugZapIcon}
          title="No provider connections yet"
          description="Connect Microsoft 365 so inboxes can send. You need a Tenant ID, Client ID and Client secret (see the guide above)."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tenant ID</TableHead>
                <TableHead>Client ID</TableHead>
                <TableHead className="text-right">Inboxes</TableHead>
                <TableHead>Last verified</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.isPending
                ? Array.from({ length: 2 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : providers.data?.data.map((provider) => {
                    const verifying = verify.isPending && verify.variables?.id === provider.id;
                    return (
                      <TableRow key={provider.id}>
                        <TableCell className="font-medium">
                          {provider.name}
                          <span className="block text-xs font-normal text-muted-foreground">
                            Microsoft 365 ·{" "}
                            {provider.sendFormat === "outlook" ? "Outlook format" : "MIME format"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ProviderStatusBadge status={provider.status} />
                          {provider.status === "error" && provider.lastError && (
                            <p className="mt-1 max-w-xs text-xs whitespace-normal text-destructive">
                              {provider.lastError}
                            </p>
                          )}
                          {provider.status === "connected" &&
                            provider.grantedPermissions &&
                            !hasMailRead(provider.grantedPermissions) && (
                              <p className="mt-1 max-w-xs text-xs whitespace-normal text-amber-700 dark:text-amber-400">
                                Mail.Read is missing: bounces and replies are not detected.
                              </p>
                            )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{provider.tenantId}</TableCell>
                        <TableCell className="font-mono text-xs">{provider.clientId}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {provider.inboxCount}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {verifying ? "Verifying…" : formatRelative(provider.lastCheckedAt)}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={<Button variant="ghost" size="icon-sm" />}
                              aria-label={`Actions for ${provider.name}`}
                            >
                              <MoreHorizontalIcon />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={verifying}
                                onClick={() => verify.mutate(provider)}
                              >
                                <ShieldCheckIcon />
                                Verify
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditing(provider);
                                  setFormOpen(true);
                                }}
                              >
                                <PencilIcon />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setToDelete(provider)}
                              >
                                <Trash2Icon />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </div>
      )}

      <ProviderFormDialog open={formOpen} onOpenChange={setFormOpen} provider={editing} />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.inboxCount
                ? `${toDelete.inboxCount} inbox(es) use this connection. They will be paused and stop sending until you edit each one, choose another provider and resume it. Their history and stats are kept.`
                : "The saved credentials will no longer be used."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                toDelete && remove.mutate(toDelete, { onSuccess: () => setToDelete(null) })
              }
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
