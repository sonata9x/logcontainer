import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const startedAt = performance.now();
  let response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);

  if (pathname.startsWith("/api/") && isMutation) {
    const fetchSite = request.headers.get("sec-fetch-site");
    const origin = request.headers.get("origin");
    if (fetchSite === "cross-site" || (origin && origin !== request.nextUrl.origin)) {
      return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  if (/^\/api\/pages\/[^/]+\/import$/.test(pathname)) {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 4 * 1024 * 1024) {
      return NextResponse.json({ error: "배포 환경에서는 HTML을 최대 4MB까지 가져올 수 있습니다." }, { status: 413 });
    }
  }

  if (pathname.startsWith("/p/")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  if (pathname.startsWith("/api/")) return response;

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

  if (pathname.startsWith("/workspace")) {
    const { data } = await supabase.auth.getClaims();
    // The workspace layout is the approval boundary. The proxy only refreshes
    // the authenticated session so every navigation does not add a second DB RPC.
    response.headers.set("Server-Timing", `proxy-auth;dur=${(performance.now() - startedAt).toFixed(1)}`);
    if (!data?.claims?.sub) return response;
  }
  return response;
}

export const config = {
  matcher: ["/workspace/:path*", "/p/:path*", "/api/:path*"]
};
