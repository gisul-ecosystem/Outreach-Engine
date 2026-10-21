"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

/** A plain single-choice dropdown: give it options, a value and an onChange. */
export function SimpleSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select…",
  invalid,
  disabled,
  className,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const labelFor = (v: unknown) => options.find((o) => o.value === v)?.label;
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => typeof next === "string" && onChange(next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-invalid={invalid} className={cn("w-full", className)}>
        <SelectValue>{(v) => labelFor(v) ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
