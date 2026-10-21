"use client";

import {
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { SimpleSelect } from "@/components/common/simple-select";
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
import { Input } from "@/components/ui/input";
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
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import type { ContactDTO } from "@/shared/contact";
import { ContactStatusBadge } from "./contact-status-badge";
import { EditContactDialog } from "./edit-contact-dialog";
import { ImportWizard } from "./import-wizard";
import { useContacts, useDeleteContact, useLists } from "./use-contacts";

const PAGE_SIZE = 25;
const ALL = "all";

export function ContactsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ContactDTO | null>(null);
  const [toDelete, setToDelete] = useState<ContactDTO | null>(null);

  const debouncedSearch = useDebouncedValue(search.trim());
  const lists = useLists();
  const contacts = useContacts({
    page,
    limit: PAGE_SIZE,
    search: debouncedSearch || undefined,
    listId: listFilter === ALL ? undefined : listFilter,
    status: statusFilter === ALL ? undefined : statusFilter,
  });
  const remove = useDeleteContact();

  const listNames = new Map((lists.data?.data ?? []).map((l) => [l.id, l.name]));
  const total = contacts.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtering = !!debouncedSearch || listFilter !== ALL || statusFilter !== ALL;
  const resetPage =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search email, name, company"
            className="pl-8"
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
          />
        </div>
        <SimpleSelect
          value={listFilter}
          onChange={resetPage(setListFilter)}
          options={[
            { value: ALL, label: "All lists" },
            ...(lists.data?.data ?? []).map((l) => ({ value: l.id, label: l.name })),
          ]}
          className="w-48"
        />
        <SimpleSelect
          value={statusFilter}
          onChange={resetPage(setStatusFilter)}
          options={[
            { value: ALL, label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "unsubscribed", label: "Unsubscribed" },
            { value: "bounced", label: "Bounced" },
          ]}
          className="w-40"
        />
        <span className="text-sm text-muted-foreground">
          {contacts.data ? `${total.toLocaleString()} contact${total === 1 ? "" : "s"}` : " "}
        </span>
        <Button className="ml-auto" onClick={() => setImportOpen(true)}>
          <UploadIcon />
          Import CSV
        </Button>
      </div>

      {contacts.isError ? (
        <div className="rounded-lg border border-destructive/30 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load contacts</p>
          <p className="mt-1 text-muted-foreground">{errorMessage(contacts.error)}</p>
        </div>
      ) : contacts.data && total === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={filtering ? "No contacts match" : "No contacts yet"}
          description={
            filtering
              ? "Try a different search or filter."
              : "Import a CSV file with an email column. A sample file is in samples/contacts-sample.csv."
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Lists</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.isPending
                ? Array.from({ length: 5 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : contacts.data?.data.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.email}</TableCell>
                      <TableCell>
                        {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
                        {contact.title && (
                          <span className="block text-xs text-muted-foreground">
                            {contact.title}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{contact.company || "—"}</TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">
                        {contact.listIds
                          .map((id) => listNames.get(id))
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        <ContactStatusBadge
                          status={contact.status}
                          suppressed={contact.suppressed}
                        />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-sm" />}
                            aria-label={`Actions for ${contact.email}`}
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(contact)}>
                              <PencilIcon />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setToDelete(contact)}
                            >
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <ImportWizard open={importOpen} onOpenChange={setImportOpen} />
      <EditContactDialog contact={editing} onClose={() => setEditing(null)} />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              The contact is removed from all lists and searches. Emails already sent to it stay in
              the history. Importing it again later restores it.
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
