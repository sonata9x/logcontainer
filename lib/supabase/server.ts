import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseEnv } from "./env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items: Array<{ name: string; value: string; options?: CookieOptions }>) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. Middleware refreshes the session.
        }
      }
    }
  });
}
