"use client";

import { CheckCircle2Icon, FileUpIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SimpleSelect } from "@/components/common/simple-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import {
  COLUMN_TARGETS,
  columnMappingSchema,
  customKey,
  FIELD_LABELS,
  MAX_IMPORT_BYTES,
  type ColumnMapping,
  type ImportPreview,
  type ImportReport,
} from "@/shared/contact";
import { isValidEmail, normalizeEmail } from "@/shared/email";
import { useCreateList, useImportConfirm, useImportPreview, useLists } from "./use-contacts";

const STEPS = ["Upload", "Map columns", "Preview", "Choose list", "Result"] as const;
type Step = 0 | 1 | 2 | 3 | 4;

const TARGET_OPTIONS = COLUMN_TARGETS.map((t) => ({ value: t, label: FIELD_LABELS[t] }));

export function ImportWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [listMode, setListMode] = useState<"existing" | "new">("existing");
  const [listId, setListId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);

  const lists = useLists();
  const previewMutation = useImportPreview();
  const confirmMutation = useImportConfirm();
  const createList = useCreateList();

  const mappingCheck = columnMappingSchema.safeParse(mapping);
  const mappingError = mappingCheck.success ? null : mappingCheck.error.issues[0].message;
  const emailColumn = Object.keys(mapping).find((c) => mapping[c] === "email");

  function reset() {
    setStep(0);
    setFile(null);
    setPreview(null);
    setMapping({});
    setListMode("existing");
    setListId(null);
    setNewListName("");
    setReport(null);
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  async function upload() {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error("The file is larger than 5 MB. Split it into smaller files.");
      return;
    }
    try {
      const result = await previewMutation.mutateAsync(file);
      setPreview(result);
      setMapping(result.suggestedMapping);
      setStep(1);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function runImport() {
    if (!file) return;
    try {
      let targetListId = listId;
      if (listMode === "new") {
        const created = await createList.mutateAsync({ name: newListName, description: "" });
        targetListId = created.id;
      }
      if (!targetListId) return;
      setReport(await confirmMutation.mutateAsync({ file, mapping, listId: targetListId }));
      setStep(4);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const importing = confirmMutation.isPending || createList.isPending;
  const listReady = listMode === "existing" ? !!listId : newListName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {STEPS.map((label, i) => (
                <span
                  key={label}
                  className={cn(
                    i === step ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {i + 1}. {label}
                </span>
              ))}
            </span>
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="grid gap-4">
            <label
              htmlFor="csv-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center hover:bg-muted/50"
            >
              <FileUpIcon className="size-8 text-muted-foreground" />
              <span className="font-medium">{file ? file.name : "Choose a CSV file"}</span>
              <span className="text-xs text-muted-foreground">
                Max 5 MB / 50,000 rows. The first row must contain column names. Excel / Google
                Sheets: File → Save as / Download → CSV.
              </span>
              <input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <DialogFooter>
              <Button onClick={upload} disabled={!file || previewMutation.isPending}>
                <UploadIcon />
                {previewMutation.isPending ? "Reading file…" : "Next"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 1 && preview && (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {preview.totalRows.toLocaleString()} rows found. Tell us what each column contains.
              Unknown columns become custom fields you can use in emails as{" "}
              <code>{"{{custom.name}}"}</code>.
            </p>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column in your file</TableHead>
                    <TableHead>Example</TableHead>
                    <TableHead className="w-56">Import as</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.columns.map((column) => (
                    <TableRow key={column}>
                      <TableCell className="font-medium">{column}</TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">
                        {preview.rows.find((r) => r[column])?.[column] ?? "—"}
                      </TableCell>
                      <TableCell>
                        <SimpleSelect
                          value={mapping[column] ?? "skip"}
                          onChange={(target) =>
                            setMapping((m) => ({ ...m, [column]: target as ColumnMapping[string] }))
                          }
                          options={TARGET_OPTIONS}
                        />
                        {mapping[column] === "custom" && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {`{{custom.${customKey(column)}}}`}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {mappingError && <p className="text-sm text-destructive">{mappingError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={() => setStep(2)} disabled={!!mappingError}>
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && preview && emailColumn && (
          <PreviewStep
            preview={preview}
            mapping={mapping}
            emailColumn={emailColumn}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <div className="flex gap-2">
              <Button
                variant={listMode === "existing" ? "default" : "outline"}
                size="sm"
                onClick={() => setListMode("existing")}
              >
                Add to an existing list
              </Button>
              <Button
                variant={listMode === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setListMode("new")}
              >
                Create a new list
              </Button>
            </div>
            {listMode === "existing" ? (
              <Field>
                <FieldLabel>List</FieldLabel>
                <SimpleSelect
                  value={listId}
                  onChange={setListId}
                  options={(lists.data?.data ?? []).map((l) => ({
                    value: l.id,
                    label: `${l.name} (${l.contactCount})`,
                  }))}
                  placeholder={
                    lists.data?.data.length ? "Choose a list" : "No lists yet — create one"
                  }
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="new-list-name">New list name</FieldLabel>
                <Input
                  id="new-list-name"
                  placeholder="e.g. SaaS founders – Oct 2026"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                />
              </Field>
            )}
            <FieldDescription>
              Contacts that already exist are not duplicated — they are added to this list and only
              empty fields are filled. Emails on the suppression list are marked and never emailed.
            </FieldDescription>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={runImport} disabled={!listReady || importing}>
                {importing ? "Importing…" : `Import ${preview?.totalRows.toLocaleString()} rows`}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 4 && report && (
          <div className="grid gap-4">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2Icon className="size-5 text-emerald-600" />
              Import finished
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(
                [
                  ["Rows in file", report.total],
                  ["New contacts", report.created],
                  ["Updated (already existed)", report.updated],
                  ["Duplicates in file", report.duplicatesInFile],
                  ["Invalid (skipped)", report.invalid],
                  ["On suppression list", report.suppressed],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
            {report.invalidRows.length > 0 && (
              <div className="grid gap-2">
                <p className="text-sm font-medium">
                  Invalid rows{report.invalid > report.invalidRows.length ? " (first 100)" : ""}
                </p>
                <div className="max-h-48 overflow-y-auto rounded-lg border text-sm">
                  {report.invalidRows.map((row) => (
                    <div key={row.row} className="flex gap-3 border-b px-3 py-1.5 last:border-0">
                      <span className="w-16 text-muted-foreground">Row {row.row}</span>
                      <span className="flex-1 truncate font-mono">{row.email || "(empty)"}</span>
                      <span className="text-muted-foreground">{row.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Step 3: the first rows as they will be imported; invalid emails are highlighted. */
function PreviewStep({
  preview,
  mapping,
  emailColumn,
  onBack,
  onNext,
}: {
  preview: ImportPreview;
  mapping: ColumnMapping;
  emailColumn: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const columnFor = (field: string) => Object.keys(mapping).find((c) => mapping[c] === field);
  const customColumns = Object.keys(mapping).filter((c) => mapping[c] === "custom");
  const fields = [
    ["Email", emailColumn],
    ["First name", columnFor("firstName")],
    ["Last name", columnFor("lastName")],
    ["Company", columnFor("company")],
    ["Job title", columnFor("title")],
  ] as const;
  const invalidInPreview = preview.rows.filter(
    (row) => !isValidEmail(normalizeEmail(row[emailColumn] ?? "")),
  ).length;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        First {preview.rows.length} of {preview.totalRows.toLocaleString()} rows.
        {customColumns.length > 0 && ` Plus ${customColumns.length} custom field(s).`}
        {invalidInPreview > 0 &&
          ` ${invalidInPreview} of these rows have an invalid email and will be skipped (shown in red).`}
      </p>
      <div className="max-h-80 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {fields.map(([label]) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((row, i) => {
              const invalid = !isValidEmail(normalizeEmail(row[emailColumn] ?? ""));
              return (
                <TableRow key={i} className={cn(invalid && "bg-destructive/10")}>
                  {fields.map(([label, column]) => (
                    <TableCell
                      key={label}
                      className={cn(
                        "max-w-40 truncate",
                        invalid && label === "Email" && "text-destructive",
                      )}
                    >
                      {column ? row[column] || "—" : "—"}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next</Button>
      </DialogFooter>
    </div>
  );
}
