import { NextResponse, type NextRequest } from "next/server";

import { auth0, isAuth0Enabled } from "./lib/auth0";

export async function middleware(request: NextRequest) {
  if (!isAuth0Enabled || !auth0) {
    return NextResponse.next();
  }

  return auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
