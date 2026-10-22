"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import {
  CreateStaffSchema,
  ResetPasswordSchema,
  UpdateStaffSchema,
  type StaffRole,
  type StaffUser,
} from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button, Field } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { fullName } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";

const STAFF_ROLES: StaffRole[] = ["ADMIN", "ADVISOR", "MECHANIC"];

/** 12 random letters/digits (no look-alikes like 0/O, 1/l) for a temporary password. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function RolePicker({ defaultValue, error }: { defaultValue?: StaffRole; error?: string }) {
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium text-slate-700">Role</legend>
      <div className="flex flex-wrap gap-4">
        {STAFF_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2 text-sm">
            <input type="radio" name="role" value={role} defaultChecked={role === (defaultValue ?? "ADVISOR")} />
            {ROLE_LABELS[role]}
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </fieldset>
  );
}

function TemporaryPasswordField({ error }: { error?: string }) {
  const [value, setValue] = useState("");
  return (
    <div>
      <div className="flex items-end gap-2">
        <Field
          label="Temporary password"
          name="temporaryPassword"
          type="text"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={error}
          className="flex-1"
        />
        <Button type="button" variant="secondary" onClick={() => setValue(generatePassword())} className="mb-[1px]">
          Generate
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Give this to the staff member in person; they can change it under Profile.</p>
    </div>
  );
}

export function AddStaffButton() {
  const router = useRouter();
  const callApi = useApi();
  const [open, setOpen] = useState(false);
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = validate(CreateStaffSchema, formValues(event.currentTarget));
    if (!body) return;
    if (await submit(() => callApi("/users", { method: "POST", body }))) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> Add staff
      </Button>
      <Modal open={open} title="Add staff member" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="firstName" maxLength={60} error={fieldErrors.firstName} />
            <Field label="Last name" name="lastName" maxLength={60} error={fieldErrors.lastName} />
          </div>
          <Field label="Email" name="email" type="email" autoComplete="off" error={fieldErrors.email} />
          <RolePicker error={fieldErrors.role} />
          <TemporaryPasswordField error={fieldErrors.temporaryPassword} />
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

type Dialog = "edit" | "reset" | "deactivate" | null;

/** The "⋯" menu on each staff row: Edit, Reset password, Deactivate / Reactivate. */
export function StaffRowActions({ user }: { user: StaffUser }) {
  const router = useRouter();
  const callApi = useApi();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const form = useFormSubmit();

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function openDialog(next: Dialog) {
    setMenuOpen(false);
    form.setError(null);
    form.setFieldErrors({});
    setDialog(next);
  }

  async function reactivate() {
    setMenuOpen(false);
    const result = await form.submit(() => callApi(`/users/${user.id}/reactivate`, { method: "POST" }));
    if (result) router.refresh();
    else setNotice(`Couldn't reactivate ${fullName(user)}. Please try again.`);
  }

  async function onEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = form.validate(UpdateStaffSchema, formValues(event.currentTarget));
    if (!body) return;
    if (await form.submit(() => callApi(`/users/${user.id}`, { method: "PATCH", body }))) {
      setDialog(null);
      router.refresh();
    }
  }

  async function onReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = form.validate(ResetPasswordSchema, formValues(event.currentTarget));
    if (!body) return;
    // 204 → api() returns null, so treat "no exception" as success.
    let ok = false;
    await form.submit(async () => {
      await callApi(`/users/${user.id}/reset-password`, { method: "POST", body });
      ok = true;
      return true;
    });
    if (ok) {
      setDialog(null);
      setNotice(`Password reset for ${fullName(user)}.`);
    }
  }

  async function onDeactivate() {
    if (await form.submit(() => callApi(`/users/${user.id}/deactivate`, { method: "POST" }))) {
      setDialog(null);
      router.refresh();
    }
  }

  return (
    <div ref={menuRef} className="relative inline-block text-left">
      <button
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={`Actions for ${fullName(user)}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {menuOpen && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg">
          <button role="menuitem" onClick={() => openDialog("edit")} className="block w-full rounded px-3 py-2 text-left hover:bg-slate-100">
            Edit
          </button>
          <button role="menuitem" onClick={() => openDialog("reset")} className="block w-full rounded px-3 py-2 text-left hover:bg-slate-100">
            Reset password
          </button>
          {user.isActive ? (
            <button
              role="menuitem"
              onClick={() => openDialog("deactivate")}
              className="block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50"
            >
              Deactivate
            </button>
          ) : (
            <button role="menuitem" onClick={reactivate} className="block w-full rounded px-3 py-2 text-left hover:bg-slate-100">
              Reactivate
            </button>
          )}
        </div>
      )}

      {notice && (
        <Modal open title="Done" onClose={() => setNotice(null)}>
          <p className="text-sm text-slate-700">{notice}</p>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setNotice(null)}>OK</Button>
          </div>
        </Modal>
      )}

      <Modal open={dialog === "edit"} title={`Edit ${fullName(user)}`} onClose={() => setDialog(null)}>
        <form onSubmit={onEdit} noValidate className="space-y-4 text-left">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="firstName" maxLength={60} defaultValue={user.firstName} error={form.fieldErrors.firstName} />
            <Field label="Last name" name="lastName" maxLength={60} defaultValue={user.lastName} error={form.fieldErrors.lastName} />
          </div>
          <RolePicker defaultValue={user.role} error={form.fieldErrors.role} />
          {form.error && <Alert>{form.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "reset"} title={`Reset password for ${fullName(user)}`} onClose={() => setDialog(null)}>
        <form onSubmit={onReset} noValidate className="space-y-4 text-left">
          <TemporaryPasswordField error={form.fieldErrors.temporaryPassword} />
          {form.error && <Alert>{form.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              Reset password
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "deactivate"} title={`Deactivate ${fullName(user)}?`} onClose={() => setDialog(null)}>
        <div className="space-y-4 text-left">
          <p className="text-sm text-slate-700">
            They will be signed out immediately and won&apos;t be able to sign in. Their work history is kept, and you can
            reactivate them later.
          </p>
          {form.error && <Alert>{form.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={form.submitting} onClick={onDeactivate}>
              Deactivate
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
