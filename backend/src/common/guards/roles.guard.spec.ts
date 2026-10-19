import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@motormate/types";
import { RolesGuard } from "./roles.guard";

function contextFor(role: Role | null): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { id: "u", role } : undefined }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: Role[] | undefined) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe("RolesGuard", () => {
  it("allows any authenticated user when the route has no @Roles", () => {
    expect(guardRequiring(undefined).canActivate(contextFor("CUSTOMER"))).toBe(true);
  });

  it("allows a user whose role is listed", () => {
    expect(guardRequiring(["ADMIN", "ADVISOR"]).canActivate(contextFor("ADVISOR"))).toBe(true);
  });

  it("blocks a user whose role is not listed", () => {
    expect(() => guardRequiring(["ADMIN"]).canActivate(contextFor("MECHANIC"))).toThrow(ForbiddenException);
  });

  it("blocks when there is no user on the request", () => {
    expect(() => guardRequiring(["ADMIN"]).canActivate(contextFor(null))).toThrow(ForbiddenException);
  });
});
