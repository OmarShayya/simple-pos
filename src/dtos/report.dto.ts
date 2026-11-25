import { IsIn, IsOptional } from "class-validator";
import { IsCalendarDate } from "./validators";
import { REPORT_PERIODS, ReportPeriod } from "../utils/period";

/** Query of GET /reports/summary */
export class ReportSummaryQueryDto {
  @IsIn(REPORT_PERIODS as unknown as string[], { message: "period must be day, week, month or year" })
  period!: ReportPeriod;

  /** Any day inside the period (YYYY-MM-DD, lounge timezone). Defaults to today. */
  @IsOptional()
  @IsCalendarDate()
  date?: string;
}
