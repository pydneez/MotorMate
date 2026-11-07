import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AuthUser, JwtClaims } from "@motormate/types";
import { setRequestShop } from "../common/tenancy/tenancy";
import { AuthService } from "./auth.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
      algorithms: ["HS256"],
    });
  }

  /**
   * Re-loads the user on every request so a deactivated account, a role change or a
   * suspended shop takes effect immediately instead of when the 8h token expires — and
   * sets the request's shop, which scopes every query from here on (common/tenancy).
   */
  async validate(claims: JwtClaims): Promise<AuthUser> {
    const user = await this.authService.findActiveUser({ sub: claims.sub, shopId: claims.shopId ?? null });
    if (!user) throw new UnauthorizedException("Session is no longer valid");
    setRequestShop(user.shopId);
    return user;
  }
}
