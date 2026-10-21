"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { minuteToTime, sendWindowSchema, timeToMinute, WEEKDAYS } from "@/shared/campaign";
import { DEFAULTS } from "@/shared/enums";
import type { WizardForm } from "./wizard-form";

/** Step 4: which days and hours emails may go out (in the app timezone). */
export function WizardStepWindow({
  form,
  onChange,
  timezone,
}: {
  form: WizardForm;
  onChange: (patch: Partial<WizardForm>) => void;
  timezone: string | null;
}) {
  const window = form.sendWindow;
  const set = (patch: Partial<WizardForm["sendWindow"]>) =>
    onChange({ sendWindow: { ...window, ...patch } });
  const check = sendWindowSchema.safeParse(window);
  const error = check.success ? null : check.error.issues[0].message;

  const toggleDay = (day: number) =>
    set({
      days: window.days.includes(day)
        ? window.days.filter((d) => d !== day)
        : [...window.days, day].sort((a, b) => a - b),
    });

  return (
    <div className="grid max-w-xl gap-5">
      <Field>
        <FieldLabel>Days</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => {
            const on = window.days.includes(day.value);
            return (
              <label
                key={day.value}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm select-none",
                  on ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground",
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={on}
                  onChange={() => toggleDay(day.value)}
                />
                {day.short}
              </label>
            );
          })}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="window-start">From</FieldLabel>
          <Input
            id="window-start"
            type="time"
            step={900}
            value={minuteToTime(window.startMinute)}
            onChange={(e) => {
              const minute = timeToMinute(e.target.value);
              if (minute !== null) set({ startMinute: Math.min(minute, 1439) });
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="window-end">Until</FieldLabel>
          <Input
            id="window-end"
            type="time"
            step={900}
            // 24:00 (end of the day) is shown as 00:00 in a time field
            value={window.endMinute === 1440 ? "00:00" : minuteToTime(window.endMinute)}
            onChange={(e) => {
              const minute = timeToMinute(e.target.value);
              if (minute !== null) set({ endMinute: minute === 0 ? 1440 : minute });
            }}
          />
        </Field>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <FieldDescription>
        Times are in <span className="font-medium text-foreground">{timezone ?? "…"}</span> (the app
        timezone). Recommended: Mon–Fri 10:00–18:00 — when people read work email.
      </FieldDescription>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() =>
          onChange({
            sendWindow: {
              startMinute: DEFAULTS.sendWindow.startMinute,
              endMinute: DEFAULTS.sendWindow.endMinute,
              days: [...DEFAULTS.sendWindow.days],
            },
          })
        }
      >
        Use recommended (Mon–Fri 10:00–18:00)
      </Button>
    </div>
  );
}
