// CSV import engine (Phase 4). Pure functions — no database — so they are easy to test.
import Papa from "papaparse";
import { ApiError } from "@/server/lib/errors";
import {
  customKey,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  STANDARD_FIELDS,
  type ColumnMapping,
  type InvalidRow,
  type StandardField,
} from "@/shared/contact";
import { isValidEmail, normalizeEmail } from "@/shared/email";

export type CsvTable = { columns: string[]; rows: Record<string, string>[] };

/** A contact built from one CSV row. Only non-empty values are present. */
export type ParsedContact = {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  custom: Record<string, string>;
};

const MAX_INVALID_ROWS_REPORTED = 100;

const csvError = (message: string) => new ApiError(400, "INVALID_CSV", message);

/** Reads an uploaded File (from request.formData()) after checking its size. */
export async function readCsvFile(file: unknown): Promise<string> {
  if (!(file instanceof File)) throw csvError('Upload a CSV file (form field "file")');
  if (file.size === 0) throw csvError("The file is empty");
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ApiError(
      413,
      "FILE_TOO_LARGE",
      "The file is larger than 5 MB. Split it into smaller files.",
    );
  }
  return file.text();
}

/** Parses CSV text with a header row. Values are trimmed; missing cells become "". */
export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<Record<string, string | undefined>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header, index) => header.trim() || `Column ${index + 1}`,
  });
  const columns = result.meta.fields ?? [];
  if (columns.length === 0) throw csvError("The file has no header row");
  if (result.data.length === 0) throw csvError("The file has a header row but no data rows");
  if (result.data.length > MAX_IMPORT_ROWS) {
    throw csvError(
      `The file has ${result.data.length.toLocaleString("en")} rows. The limit is ${MAX_IMPORT_ROWS.toLocaleString("en")}.`,
    );
  }
  const rows = result.data.map((raw) =>
    Object.fromEntries(columns.map((column) => [column, (raw[column] ?? "").toString().trim()])),
  );
  return { columns, rows };
}

const squash = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

const SYNONYMS: Record<StandardField, string[]> = {
  email: ["email", "emailaddress", "mail", "emailid", "workemail", "businessemail"],
  firstName: ["firstname", "first", "givenname", "fname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname", "lname"],
  company: [
    "company",
    "companyname",
    "organization",
    "organisation",
    "account",
    "accountname",
    "employer",
  ],
  title: ["title", "jobtitle", "position", "role", "designation"],
};

/** Guesses where each column should go, from its header name. */
export function suggestMapping(columns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<StandardField>();
  for (const column of columns) {
    const key = squash(column);
    const field = STANDARD_FIELDS.find((f) => !used.has(f) && SYNONYMS[f].includes(key));
    if (field) used.add(field);
    mapping[column] = field ?? "custom";
  }
  // No exact email header? Use the first column whose name contains "mail".
  if (!used.has("email")) {
    const guess = columns.find((c) => squash(c).includes("mail") && mapping[c] === "custom");
    if (guess) mapping[guess] = "email";
  }
  return mapping;
}

export { customKey };

/**
 * Turns CSV rows into contacts: normalizes emails, skips invalid ones, merges duplicates inside the file
 * (the first value of each field wins; later rows only fill empty fields).
 */
export function buildContacts(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): {
  contacts: ParsedContact[];
  total: number;
  invalid: number;
  invalidRows: InvalidRow[];
  duplicatesInFile: number;
} {
  const emailColumn = Object.keys(mapping).find((column) => mapping[column] === "email");
  if (!emailColumn) throw csvError("Choose which column contains the email address");

  const byEmail = new Map<string, ParsedContact>();
  const invalidRows: InvalidRow[] = [];
  let invalid = 0;
  let duplicatesInFile = 0;

  rows.forEach((row, index) => {
    const rawEmail = row[emailColumn] ?? "";
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      invalid++;
      if (invalidRows.length < MAX_INVALID_ROWS_REPORTED) {
        invalidRows.push({
          row: index + 2, // +1 for the header row, +1 because spreadsheets start at 1
          email: rawEmail,
          reason: rawEmail ? "Not a valid email address" : "Email is empty",
        });
      }
      return;
    }

    const contact: ParsedContact = { email, custom: {} };
    for (const [column, target] of Object.entries(mapping)) {
      const value = row[column] ?? "";
      if (!value || target === "email" || target === "skip") continue;
      if (target === "custom") contact.custom[customKey(column)] = value;
      else contact[target] = value;
    }

    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, contact);
      return;
    }
    duplicatesInFile++;
    for (const field of ["firstName", "lastName", "company", "title"] as const) {
      existing[field] ??= contact[field];
    }
    existing.custom = { ...contact.custom, ...existing.custom };
  });

  return {
    contacts: [...byEmail.values()],
    total: rows.length,
    invalid,
    invalidRows,
    duplicatesInFile,
  };
}

/** Finds the email column of a suppression CSV: a column named like "email", or the only column. */
export function findEmailColumn(columns: string[]): string {
  const named = columns.find((c) => SYNONYMS.email.includes(squash(c)));
  if (named) return named;
  if (columns.length === 1) return columns[0];
  throw csvError('The CSV needs a column named "email"');
}
