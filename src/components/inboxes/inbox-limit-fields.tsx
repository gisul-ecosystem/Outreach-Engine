"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DAILY_LIMIT_HINT_ABOVE, MAX_DAILY_LIMIT, MIN_GAP_SECONDS } from "@/shared/inbox";

type LimitValues = { dailyLimit?: unknown; minGapSeconds?: unknown; maxGapSeconds?: unknown };

const describeSeconds = (value: unknown) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return " ";
  return seconds >= 60 ? `≈ ${Math.round((seconds / 60) * 10) / 10} minutes` : `${seconds} seconds`;
};

/**
 * Daily limit + random gap range, shared by the add and edit inbox dialogs.
 * Must be rendered inside a react-hook-form <FormProvider>.
 */
export function InboxLimitFields() {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<LimitValues>();
  const [dailyLimitValue, minGap, maxGap] = useWatch({
    control,
    name: ["dailyLimit", "minGapSeconds", "maxGapSeconds"],
  });
  const dailyLimit = Number(dailyLimitValue);

  return (
    <>
      <Field data-invalid={!!errors.dailyLimit}>
        <FieldLabel htmlFor="daily-limit">Daily limit (emails per day)</FieldLabel>
        <Input
          id="daily-limit"
          type="number"
          min={1}
          max={MAX_DAILY_LIMIT}
          inputMode="numeric"
          aria-invalid={!!errors.dailyLimit}
          {...register("dailyLimit")}
        />
        {dailyLimit > DAILY_LIMIT_HINT_ABOVE && (
          <FieldDescription className="text-amber-700 dark:text-amber-400">
            New inboxes: start with 10–15/day and increase slowly
          </FieldDescription>
        )}
        <FieldError errors={[errors.dailyLimit]} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field data-invalid={!!errors.minGapSeconds}>
          <FieldLabel htmlFor="min-gap">Min gap (seconds)</FieldLabel>
          <Input
            id="min-gap"
            type="number"
            min={MIN_GAP_SECONDS}
            inputMode="numeric"
            aria-invalid={!!errors.minGapSeconds}
            {...register("minGapSeconds")}
          />
          <FieldDescription>{describeSeconds(minGap)}</FieldDescription>
          <FieldError errors={[errors.minGapSeconds]} />
        </Field>
        <Field data-invalid={!!errors.maxGapSeconds}>
          <FieldLabel htmlFor="max-gap">Max gap (seconds)</FieldLabel>
          <Input
            id="max-gap"
            type="number"
            min={MIN_GAP_SECONDS}
            inputMode="numeric"
            aria-invalid={!!errors.maxGapSeconds}
            {...register("maxGapSeconds")}
          />
          <FieldDescription>{describeSeconds(maxGap)}</FieldDescription>
          <FieldError errors={[errors.maxGapSeconds]} />
        </Field>
      </div>
      <FieldDescription>
        Between two emails from this inbox the app waits a random time between the min and max gap.
      </FieldDescription>
    </>
  );
}
