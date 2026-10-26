// Public tracking link: https://go.racko.ai/r/<token> → saves the click → 302 to racko.ai.
// No login (src/proxy.ts lets /r/ through). The person never sees an error page: an unknown token or
// any problem sends them to TRACKING_FALLBACK_URL.
//
// 302 ("moved for now"), not 301 ("moved forever"): browsers remember a 301 and skip our server the
// next time, so repeat clicks would be lost.
import type { NextRequest } from "next/server";
import { resolveClick } from "@/server/services/click.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

async function redirect(request: NextRequest, { params }: Context) {
  const { token } = await params;
  const location = await resolveClick({
    token,
    method: request.method,
    headers: request.headers,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

export const GET = redirect;
export const HEAD = redirect;
