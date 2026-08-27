import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const startedAt = performance.now();
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items: Array<{ name: string; value: string; options?: CookieOptions }>) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  if (request.nextUrl.pathname.startsWith("/workspace")) {
    const { data } = await supabase.auth.getClaims();
    // The workspace layout is the approval boundary. Middleware only refreshes
    // the authenticated session so every navigation does not add a second DB RPC.
    response.headers.set("Server-Timing", `middleware-auth;dur=${(performance.now() - startedAt).toFixed(1)}`);
    if (!data?.claims?.sub) return response;
  }
  if (request.nextUrl.pathname.startsWith("/p/")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  matcher: ["/workspace/:path*", "/p/:path*"]
};
