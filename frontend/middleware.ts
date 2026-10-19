import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";
import { canAccess } from "./lib/nav";

/**
 * Signed-out users hitting /app/* go to /login (with a callbackUrl back). Signed-in users
 * opening a section their role can't use get the "no access" page.
 */
export default withAuth(
  function middleware(request) {
    const token = request.nextauth.token;
    if (!token) return NextResponse.next();

    if (Date.now() >= token.accessTokenExpires) {
      const url = new URL("/login", request.url);
      url.searchParams.set("expired", "1");
      return NextResponse.redirect(url);
    }

    const slug = request.nextUrl.pathname.split("/")[2] ?? "";
    if (slug !== "forbidden" && !canAccess(token.user.role, slug)) {
      return NextResponse.rewrite(new URL("/app/forbidden", request.url));
    }
    return NextResponse.next();
  },
  { pages: { signIn: "/login" } },
);

export const config = { matcher: ["/app/:path*"] };
