import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  const saved = request.cookies.get("izbri.locale")?.value;
  const preferred = saved === "es" || saved === "en" ? saved : request.headers.get("accept-language")?.toLowerCase().startsWith("es") ? "es" : "en";
  return NextResponse.redirect(new URL(`/${preferred}`, request.url));
}
export const config = { matcher: ["/"] };
