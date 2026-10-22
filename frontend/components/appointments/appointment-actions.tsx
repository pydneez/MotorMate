"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  appointmentActions,
  bangkokParts,
  CancelAppointmentSchema,
  RescheduleAppointmentSchema,
  SHOP,
  type AppointmentSummary,
  type Role,
} from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button, Field, LinkButton } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatAppointmentTime } from "@/lib/format";
import { AppointmentTimeFields } from "./appointment-time-fields";

type Dialog = "reschedule" | "cancel" | "noShow" | null;

const SMALL = "px-2.5 py-1 text-xs";

/**
 * The buttons that fit this appointment for this role (appointmentActions() from
 * packages/types — the API applies the same rules). Customers inside the 2-hour cut-off
 * see a "call us" note instead.
 */
export function AppointmentActions({ appointment, role }: { appointment: AppointmentSummary; role: Role }) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, submit, setError } = useFormSubmit();
  const [dialog, setDialog] = useState<Dialog>(null);
  const actions = appointmentActions(appointment, role);
  const isCustomer = role === "CUSTOMER";
  const upcoming =
    (appointment.status === "REQUESTED" || appointment.status === "CONFIRMED") && new Date(appointment.scheduledAt).getTime() > Date.now();

  function open(next: Dialog) {
    setError(null);
    setDialog(next);
  }

  async function run(path: string, init: Parameters<typeof callApi>[1]) {
    if (await submit(() => callApi(`/appointments/${appointment.id}${path}`, init))) {
      setDialog(null);
      router.refresh();
    }
  }

  async function onReschedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = validate(RescheduleAppointmentSchema, formValues(event.currentTarget));
    if (body) await run("", { method: "PATCH", body });
  }

  async function onCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = validate(CancelAppointmentSchema, formValues(event.currentTarget));
    if (body) await run("/cancel", { method: "POST", body });
  }

  if (actions.length === 0) {
    return isCustomer && upcoming ? (
      <p className="text-xs text-slate-500">Less than 2 hours to go — to change it, call {SHOP.phone}.</p>
    ) : null;
  }

  const when = bangkokParts(appointment.scheduledAt);
  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.includes("confirm") && (
        <Button className={SMALL} loading={submitting && dialog === null} onClick={() => run("/confirm", { method: "POST" })}>
          Confirm
        </Button>
      )}
      {actions.includes("checkIn") && (
        <LinkButton href={`/app/work-orders/new?appointment=${appointment.id}`} className={SMALL}>
          Check in
        </LinkButton>
      )}
      {actions.includes("reschedule") && (
        <Button variant="secondary" className={SMALL} onClick={() => open("reschedule")}>
          {isCustomer ? "Change time" : "Reschedule"}
        </Button>
      )}
      {actions.includes("noShow") && (
        <Button variant="secondary" className={SMALL} onClick={() => open("noShow")}>
          No-show
        </Button>
      )}
      {actions.includes("cancel") && (
        <Button variant="secondary" className={SMALL} onClick={() => open("cancel")}>
          Cancel
        </Button>
      )}
      {error && dialog === null && <p className="w-full text-xs text-red-700">{error}</p>}

      <Modal open={dialog === "reschedule"} title={isCustomer ? "Change the time" : "Reschedule"} onClose={() => setDialog(null)}>
        <form onSubmit={onReschedule} noValidate className="space-y-4">
          <p className="text-sm text-slate-600">Now: {formatAppointmentTime(appointment.scheduledAt)}</p>
          <AppointmentTimeFields errors={fieldErrors} defaults={{ date: when.date, time: when.time }} />
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button type="submit" loading={submitting}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "cancel"} title="Cancel this appointment?" onClose={() => setDialog(null)}>
        <form onSubmit={onCancel} noValidate className="space-y-4">
          <p className="text-sm text-slate-700">
            {formatAppointmentTime(appointment.scheduledAt)} · {appointment.vehicle.make} {appointment.vehicle.model} ·{" "}
            {appointment.reason}
          </p>
          <Field label="Reason (optional)" name="reason" placeholder={isCustomer ? "e.g. Can't make it" : "e.g. Customer called to cancel"} error={fieldErrors.reason} />
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" loading={submitting}>
              Cancel appointment
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "noShow"} title="Mark as a no-show?" onClose={() => setDialog(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            {appointment.customer.name} didn&apos;t come in for {formatAppointmentTime(appointment.scheduledAt)}.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button variant="danger" loading={submitting} onClick={() => run("/no-show", { method: "POST" })}>
              Mark no-show
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
