import { IsIn, IsOptional, Matches } from "class-validator";
import { REPORT_PERIODS, ReportPeriod } from "../utils/period";

/** Query of GET /reports/summary */
export class ReportSummaryQueryDto {
  @IsIn(REPORT_PERIODS as unknown as string[], { message: "period must be day, week, month or year" })
  period!: ReportPeriod;

  /** Any day inside the period (YYYY-MM-DD, lounge timezone). Defaults to today. */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { message: "date must be YYYY-MM-DD" })
  date?: string;
}
