"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { CreateServiceSchema, UpdateServiceSchema, type ServiceCatalogEntry } from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button, Field } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";

/** Name, category (existing ones suggested), price and "customers can book it". */
function ServiceFields({
  service,
  categories,
  fieldErrors,
}: {
  service?: ServiceCatalogEntry;
  categories: string[];
  fieldErrors: Record<string, string | undefined>;
}) {
  return (
    <>
      <Field label="Service" name="name" defaultValue={service?.name} maxLength={120} placeholder="Oil change" error={fieldErrors.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" name="category" list="service-categories" defaultValue={service?.category} maxLength={50} error={fieldErrors.category} />
        <Field
          label="Price (฿, excl. VAT)"
          name="price"
          inputMode="decimal"
          defaultValue={service?.price}
          error={fieldErrors.price}
        />
      </div>
      <datalist id="service-categories">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="bookable" defaultChecked={service?.bookable ?? true} className="mt-0.5" />
        <span>
          Customers can book it online
          <span className="block text-xs text-slate-500">Untick for jobs that need an inspection first; staff can still add them.</span>
        </span>
      </label>
    </>
  );
}

/** The form's values with the checkbox as a boolean (an unticked box isn't in FormData at all). */
function serviceValues(form: HTMLFormElement) {
  return { ...formValues(form), bookable: new FormData(form).has("bookable") };
}

export function AddServiceButton({ categories }: { categories: string[] }) {
  const router = useRouter();
  const callApi = useApi();
  const [open, setOpen] = useState(false);
  const { fieldErrors, error, submitting, validate, submit, setError, setFieldErrors } = useFormSubmit();

  function show() {
    setError(null);
    setFieldErrors({});
    setOpen(true);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = validate(CreateServiceSchema, serviceValues(event.currentTarget));
    if (!body) return;
    if (await submit(() => callApi("/services", { method: "POST", body }))) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <Button onClick={show}>
        <Plus className="h-4 w-4" aria-hidden /> Add service
      </Button>
      <Modal open={open} title="Add a service" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <ServiceFields categories={categories} fieldErrors={fieldErrors} />
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Add
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

type Dialog = "edit" | "deactivate" | null;

/** Edit, and Deactivate / Reactivate. Services are never deleted: past jobs keep pointing at them. */
export function ServiceRowActions({ service, categories }: { service: ServiceCatalogEntry; categories: string[] }) {
  const router = useRouter();
  const callApi = useApi();
  const [dialog, setDialog] = useState<Dialog>(null);
  const { fieldErrors, error, submitting, validate, submit, setError, setFieldErrors } = useFormSubmit();

  function open(next: Dialog) {
    setError(null);
    setFieldErrors({});
    setDialog(next);
  }

  async function save(body: object) {
    if (await submit(() => callApi(`/services/${service.id}`, { method: "PATCH", body }))) {
      setDialog(null);
      router.refresh();
    }
  }

  async function onEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = validate(UpdateServiceSchema, serviceValues(event.currentTarget));
    if (body) await save(body);
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => open("edit")}>
        Edit
      </Button>
      {service.isActive ? (
        <Button variant="dangerOutline" className="px-2.5 py-1 text-xs" onClick={() => open("deactivate")}>
          Deactivate
        </Button>
      ) : (
        <Button variant="secondary" className="px-2.5 py-1 text-xs" loading={submitting && dialog === null} onClick={() => save({ isActive: true })}>
          Reactivate
        </Button>
      )}

      <Modal open={dialog === "edit"} title={`Edit ${service.name}`} onClose={() => setDialog(null)}>
        <form onSubmit={onEdit} noValidate className="space-y-4">
          <ServiceFields service={service} categories={categories} fieldErrors={fieldErrors} />
          <p className="text-xs text-slate-500">
            A new price applies to lines added from now on. Jobs and bookings already made keep the price they were given.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "deactivate"} title={`Deactivate ${service.name}?`} onClose={() => setDialog(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            It disappears from the booking form and the labour picker. Past jobs and bookings keep it, and you can reactivate it
            later.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={submitting} onClick={() => save({ isActive: false })}>
              Deactivate
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
