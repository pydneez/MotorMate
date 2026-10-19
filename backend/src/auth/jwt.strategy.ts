import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AuthUser, JwtClaims } from "@motormate/types";
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
   * Re-loads the user on every request so a deactivated account or a role change takes
   * effect immediately instead of when the 8h token expires.
   */
  async validate(claims: JwtClaims): Promise<AuthUser> {
    const user = await this.authService.findActiveUser(claims.sub);
    if (!user) throw new UnauthorizedException("Session is no longer valid");
    return user;
  }
}
