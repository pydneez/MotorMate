import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { createPrismaMock, makeAuthUser } from "../../test/prisma-mock";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";

const CURRENT = "password123";

function setup() {
  const { prisma, service } = createPrismaMock();
  const auth = new AuthService(service, {} as JwtService);
  prisma.user.findUnique.mockResolvedValue({
    id: "user-1",
    passwordHash: bcrypt.hashSync(CURRENT, 4),
    isActive: true,
    role: "ADVISOR",
    email: "advisor@motormate.example",
    firstName: "Alex",
    lastName: "Rivera",
    customer: null,
  });
  return { prisma, auth };
}

describe("AuthService.changePassword", () => {
  it("replaces the hash when the current password is correct", async () => {
    const { prisma, auth } = setup();

    await auth.changePassword("user-1", { currentPassword: CURRENT, newPassword: "brand-new-pass" });

    const { passwordHash } = prisma.user.update.mock.calls[0][0].data;
    expect(await bcrypt.compare("brand-new-pass", passwordHash)).toBe(true);
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe("user.passwordChanged");
  });

  it("rejects a wrong current password with a 400 field error, not a 401", async () => {
    const { prisma, auth } = setup();

    const attempt = auth.changePassword("user-1", { currentPassword: "wrong", newPassword: "brand-new-pass" });

    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.not.toThrow(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("JwtStrategy.validate", () => {
  function strategyFor(found: unknown) {
    const authService = { findActiveUser: jest.fn().mockResolvedValue(found) } as unknown as AuthService;
    process.env.JWT_SECRET ??= "test-secret";
    return new JwtStrategy(authService);
  }
  const claims = { sub: "user-1", email: "a@b.com", role: "ADVISOR" as const, iat: 0, exp: 0 };

  it("accepts a token for an active user", async () => {
    const user = makeAuthUser({ id: "user-1", role: "ADVISOR" });
    await expect(strategyFor(user).validate(claims)).resolves.toEqual(user);
  });

  it("rejects a still-unexpired token once the user has been deactivated", async () => {
    await expect(strategyFor(null).validate(claims)).rejects.toThrow(UnauthorizedException);
  });
});
