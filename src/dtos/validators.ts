import { registerDecorator, ValidationOptions } from "class-validator";
import { isDateString } from "../utils/time";

/** A real calendar day written as YYYY-MM-DD (interpreted in the lounge timezone by the services). */
export const IsCalendarDate = (options?: ValidationOptions) => (target: object, propertyName: string) =>
  registerDecorator({
    name: "isCalendarDate",
    target: target.constructor,
    propertyName,
    options: { message: `${propertyName} must be a date written as YYYY-MM-DD`, ...options },
    validator: { validate: (value: unknown) => typeof value === "string" && isDateString(value) },
  });
