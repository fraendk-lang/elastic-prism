/**
 * Optional preview gate on Vercel (Edge).
 * Set SITE_ACCESS_PASSWORD in Vercel → Project → Settings → Environment Variables.
 * Leave unset or empty → no protection (e.g. local `npm run dev` and public launch).
 *
 * Browser shows a login dialog (HTTP Basic). Username can be anything; only the password is checked.
 */
export const config = {
  matcher: '/:path*',
};

export default function middleware(request: Request): Response | Promise<Response> {
  const password = process.env.SITE_ACCESS_PASSWORD?.trim();
  if (!password) {
    return fetch(request);
  }

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6).trim());
      const idx = decoded.indexOf(':');
      const supplied = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      if (supplied === password) {
        return fetch(request);
      }
    } catch {
      /* invalid base64 */
    }
  }

  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Elastic Prism"',
      'Cache-Control': 'no-store',
    },
  });
}
