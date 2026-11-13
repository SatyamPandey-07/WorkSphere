import { z } from "zod";

export const DEFAULT_MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DateFilterOptions {
  maxRangeDays?: number;
}

export interface DateRangeValidationError {
  success: false;
  code: "INVALID_DATE_RANGE";
  message: string;
  issues: Array<{
    path: string;
    message: string;
  }>;
}

export interface DateRangeValidationSuccess {
  success: true;
  data: {
    startDate?: Date;
    endDate?: Date;
  };
}

export type DateRangeValidationResult =
  DateRangeValidationSuccess | DateRangeValidationError;

const timestampFieldSchema = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === "") return undefined;
    if (val instanceof Date) return val;
    if (typeof val === "string" || typeof val === "number") {
      const parsed = new Date(val);
      return parsed;
    }
    return val;
  },
  z
    .date({
      invalid_type_error: "Invalid timestamp format",
    })
    .refine((d) => !Number.isNaN(d.getTime()), {
      message: "Invalid timestamp value",
    })
    .optional(),
);

export function createDateFilterSchema(options: DateFilterOptions = {}) {
  const { maxRangeDays } = options;

  return z
    .object({
      startDate: timestampFieldSchema,
      endDate: timestampFieldSchema,
    })
    .refine(
      (data) => {
        if (!data.startDate || !data.endDate) return true;
        return data.startDate.getTime() <= data.endDate.getTime();
      },
      {
        message: "startDate must be chronologically before or equal to endDate",
        path: ["endDate"],
        params: { code: "INVALID_DATE_RANGE" },
      },
    )
    .refine(
      (data) => {
        if (!maxRangeDays || !data.startDate || !data.endDate) return true;
        const diffMs = data.endDate.getTime() - data.startDate.getTime();
        return diffMs <= maxRangeDays * MS_PER_DAY;
      },
      {
        message: `Date range cannot exceed ${maxRangeDays ?? DEFAULT_MAX_RANGE_DAYS} days`,
        path: ["endDate"],
        params: { code: "INVALID_DATE_RANGE" },
      },
    );
}

export const dateFilterSchema = createDateFilterSchema();

export function parseDateFilter(
  input: {
    startDate?: unknown;
    endDate?: unknown;
  },
  options: DateFilterOptions = {},
): DateRangeValidationResult {
  const schema = options.maxRangeDays
    ? createDateFilterSchema(options)
    : dateFilterSchema;

  const result = schema.safeParse(input);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "dateRange",
      message: issue.message,
    }));

    return {
      success: false,
      code: "INVALID_DATE_RANGE",
      message: issues[0]?.message ?? "Invalid date range parameters",
      issues,
    };
  }

  return {
    success: true,
    data: result.data,
  };
}
