import { appointmentSlots, bangkokParts, BOOKING_MAX_DAYS, SHOP } from "@motormate/types";
import { Field, SelectField } from "@/components/ui";

/** Date + time (shop slots) inputs shared by booking and rescheduling. */
export function AppointmentTimeFields({
  errors,
  defaults,
}: {
  errors: { date?: string; time?: string };
  defaults?: { date: string; time: string };
}) {
  const today = bangkokParts(new Date()).date;
  const last = bangkokParts(new Date(Date.now() + BOOKING_MAX_DAYS * 24 * 60 * 60 * 1000)).date;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Date" name="date" type="date" min={today} max={last} defaultValue={defaults?.date} error={errors.date} />
      <SelectField label="Time" name="time" defaultValue={defaults?.time ?? ""} error={errors.time}>
        <option value="" disabled>
          Choose a time
        </option>
        {appointmentSlots().map((slot) => (
          <option key={slot} value={slot}>
            {slot}
          </option>
        ))}
      </SelectField>
      <p className="-mt-2 text-xs text-slate-500 sm:col-span-2">
        Open {SHOP.hours.label}. Book at least 2 hours ahead.
      </p>
    </div>
  );
}
