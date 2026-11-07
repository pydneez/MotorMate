import { ForbiddenException } from "@nestjs/common";
import { shopFilter, withCondition } from "./shop-scope.extension";
import { currentShopId, queryShopId, runAsShop, runRequest, runUnscoped, setRequestShop } from "./tenancy";

describe("shop context (tenancy.ts)", () => {
  it("doesn't scope outside a request (seeds, test setup)", () => {
    expect(queryShopId()).toBeNull();
  });

  it("scopes a request once the user's shop is known, and refuses before", (done) => {
    runRequest(() => {
      expect(() => queryShopId()).toThrow(ForbiddenException);
      setRequestShop("shop-a");
      // Still set after an await — the store follows the request's async work.
      void Promise.resolve().then(() => {
        expect(queryShopId()).toBe("shop-a");
        expect(currentShopId()).toBe("shop-a");
        done();
      });
    });
  });

  it("runs one shop's work, or platform-wide work, explicitly", async () => {
    await expect(runAsShop("shop-b", () => queryShopId())).resolves.toBe("shop-b");
    await expect(runUnscoped(() => queryShopId())).resolves.toBeNull();
    await expect(runUnscoped(() => currentShopId())).rejects.toThrow(ForbiddenException);
  });
});

describe("shop filter (shop-scope.extension.ts)", () => {
  it("filters own-shop tables on shopId and child tables through their parent", () => {
    expect(shopFilter("Customer", "s1")).toEqual({ shopId: "s1" });
    expect(shopFilter("Invoice", "s1")).toEqual({ shopId: "s1" });
    expect(shopFilter("Appointment", "s1")).toEqual({ customer: { shopId: "s1" } });
    expect(shopFilter("PartUsed", "s1")).toEqual({ workOrder: { shopId: "s1" } });
    expect(shopFilter("AppointmentService", "s1")).toEqual({ appointment: { customer: { shopId: "s1" } } });
  });

  it("leaves logins, shops and the audit log alone", () => {
    expect(shopFilter("User", "s1")).toBeNull();
    expect(shopFilter("Shop", "s1")).toBeNull();
    expect(shopFilter("AuditLog", "s1")).toBeNull();
  });

  it("adds the condition without disturbing unique keys or existing ANDs", () => {
    expect(withCondition({ id: "c1" }, { shopId: "s1" })).toEqual({ id: "c1", AND: [{ shopId: "s1" }] });
    expect(withCondition(undefined, { shopId: "s1" })).toEqual({ AND: [{ shopId: "s1" }] });
    expect(withCondition({ AND: [{ a: 1 }], b: 2 }, { shopId: "s1" })).toEqual({ AND: [{ a: 1 }, { shopId: "s1" }], b: 2 });
    expect(withCondition({ AND: { a: 1 } }, { shopId: "s1" })).toEqual({ AND: [{ a: 1 }, { shopId: "s1" }] });
  });
});
