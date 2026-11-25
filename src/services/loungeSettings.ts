import ReservationSettings, { DEFAULT_SCHEDULE, IDaySchedule } from "../models/reservationSettings.model";

/**
 * Read-only access to the lounge-wide settings that live on the reservation settings document
 * (timezone + opening hours). Reads the model directly so any service can use it without
 * importing the reservation service (which would create import cycles).
 */
export const DEFAULT_TIMEZONE = "Asia/Beirut";

export interface LoungeHours {
  timezone: string;
  schedule: IDaySchedule[];
}

export const getLoungeHours = async (): Promise<LoungeHours> => {
  const settings = await ReservationSettings.findOne({ key: "default" })
    .select("timezone schedule")
    .lean<{ timezone?: string; schedule?: IDaySchedule[] }>();
  return {
    timezone: settings?.timezone || DEFAULT_TIMEZONE,
    schedule: settings?.schedule?.length ? settings.schedule : DEFAULT_SCHEDULE,
  };
};

export const getLoungeTimezone = async (): Promise<string> => (await getLoungeHours()).timezone;
