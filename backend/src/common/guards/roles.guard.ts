import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthUser, Role } from "@motormate/types";
import { ROLES_KEY } from "../decorators/roles.decorator";

/** Global guard: enforces @Roles(...). Routes without @Roles only need authentication. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException("You don't have permission to do this");
    }
    return true;
  }
}
