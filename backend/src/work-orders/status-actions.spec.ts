import {
  allowedNextStatuses,
  statusActionFor,
  statusActions,
  statusHint,
  WORK_ORDER_STEPS,
  WorkOrderStatusSchema,
  type Role,
  type WorkOrderStatus,
} from "@motormate/types";

/** Status buttons and hints (packages/types): names, colours and order for the moves the API allows. */

type User = { role: Role; isAssignedMechanic: boolean };

const STATUSES = WorkOrderStatusSchema.options;
const advisor: User = { role: "ADVISOR", isAssignedMechanic: false };
const assigned: User = { role: "MECHANIC", isAssignedMechanic: true };
const otherMechanic: User = { role: "MECHANIC", isAssignedMechanic: false };

const labels = (status: WorkOrderStatus, user: User = advisor) => statusActions(status, user).map((action) => action.label);

describe("work-order status buttons", () => {
  it("offers exactly the moves the API allows, each with a label and a colour", () => {
    for (const status of STATUSES) {
      for (const user of [advisor, assigned, otherMechanic]) {
        const actions = statusActions(status, user);
        expect(actions.map((action) => action.to).sort()).toEqual([...allowedNextStatuses(status, user)].sort());
        for (const action of actions) {
          expect(action.label).not.toMatch(/→/);
          expect(["primary", "success", "warning", "danger"]).toContain(action.tone);
        }
      }
    }
  });

  it("puts the normal next step first and Cancel last", () => {
    expect(labels("CHECKED_IN")).toEqual(["Start diagnosis", "Cancel job"]);
    expect(labels("DIAGNOSING")).toEqual(["Start repair", "Waiting for parts", "Cancel job"]);
    expect(labels("AWAITING_PARTS")).toEqual(["Parts arrived — resume", "Cancel job"]);
    expect(labels("IN_PROGRESS")).toEqual(["Send to quality check", "Waiting for parts", "Cancel job"]);
    expect(labels("QUALITY_CHECK")).toEqual(["Pass QC & invoice", "Fail QC — back to repair", "Cancel job"]);
    expect(statusActions("IN_PROGRESS", advisor).map((action) => action.normal)).toEqual([true, false, false]);
    expect(labels("COMPLETED")).toEqual([]);
    expect(labels("CANCELLED")).toEqual([]);
  });

  it("colours moves by meaning", () => {
    expect(statusActionFor("QUALITY_CHECK", "COMPLETED").tone).toBe("success");
    expect(statusActionFor("QUALITY_CHECK", "IN_PROGRESS").tone).toBe("warning");
    expect(statusActionFor("IN_PROGRESS", "AWAITING_PARTS").tone).toBe("warning");
    expect(statusActionFor("DIAGNOSING", "CANCELLED").tone).toBe("danger");
    expect(statusActionFor("AWAITING_PARTS", "IN_PROGRESS").tone).toBe("primary");
  });

  it("never gives a mechanic the QC sign-off or Cancel, and nothing on someone else's job", () => {
    expect(labels("QUALITY_CHECK", assigned)).toEqual(["Fail QC — back to repair"]);
    expect(labels("IN_PROGRESS", assigned)).toEqual(["Send to quality check", "Waiting for parts"]);
    expect(labels("IN_PROGRESS", otherMechanic)).toEqual([]);
  });

  it("has a hint for every open status, and tells mechanics QC is the advisor's job", () => {
    for (const status of STATUSES) {
      const closed = status === "COMPLETED" || status === "CANCELLED";
      expect(statusHint(status, "ADVISOR") === null).toBe(closed);
    }
    expect(statusHint("QUALITY_CHECK", "MECHANIC")).toBe("Waiting for an advisor's quality check.");
    expect(statusHint("QUALITY_CHECK", "ADVISOR")).toMatch(/pass to issue the invoice/);
  });

  it("shows the five steps of the normal path, without Awaiting parts or Cancelled", () => {
    expect(WORK_ORDER_STEPS).toEqual(["CHECKED_IN", "DIAGNOSING", "IN_PROGRESS", "QUALITY_CHECK", "COMPLETED"]);
  });
});
