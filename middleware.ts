/**
 * Elastic Universe — Unified Password Protection
 * Set SITE_PASSWORD in Vercel → Project → Environment Variables.
 * Leave unset or empty → no protection.
 * Same password page design as elasticuniverse.app.
 */

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|assets/).*)',
};

const COOKIE_NAME = 'eu-auth';

export default function middleware(request: Request): Response | undefined {
  const password = (process.env.SITE_PASSWORD || '').trim();
  if (!password) return;

  // Skip static assets
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    path.startsWith('/assets') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.ico') ||
    path.endsWith('.woff2')
  ) {
    return;
  }

  // Check auth cookie
  const cookies = request.headers.get('cookie') || '';
  const hasAuth = cookies.split(';').some(c => c.trim().startsWith(`${COOKIE_NAME}=granted`));
  if (hasAuth) return;

  // Check password submission
  const submitted = url.searchParams.get('password');
  if (submitted === password) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: path,
        'Set-Cookie': `${COOKIE_NAME}=granted; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}; Path=/`,
      },
    });
  }

  const errorHtml = submitted !== null && submitted !== password
    ? '<p class="error">Incorrect password</p>'
    : '';

  // Password page
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Elastic Universe — Access</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #000; color: #fff; font-family: system-ui, -apple-system, sans-serif;
    }
    .container { text-align: center; max-width: 360px; padding: 24px; }
    .logo { margin-bottom: 16px; opacity: 0.6; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
    p { font-size: 13px; color: #666; margin-bottom: 28px; }
    form { display: flex; gap: 8px; }
    input {
      flex: 1; padding: 12px 16px; border-radius: 12px; border: 1px solid #222;
      background: #111; color: #fff; font-size: 14px; outline: none;
    }
    input:focus { border-color: #00FF88; }
    button {
      padding: 12px 20px; border-radius: 12px; border: none;
      background: #00FF88; color: #000; font-weight: 600; font-size: 14px;
      cursor: pointer; transition: opacity 0.2s;
    }
    button:hover { opacity: 0.85; }
    .error { color: #f87171; font-size: 12px; margin-top: 12px; margin-bottom: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin:0 auto">
        <circle cx="16" cy="16" r="3" fill="#4D9BFF" opacity="0.8"/>
        <ellipse cx="16" cy="16" rx="12" ry="6" fill="none" stroke="#4D9BFF" stroke-width="1" opacity="0.5"/>
        <ellipse cx="16" cy="16" rx="12" ry="6" fill="none" stroke="#00D4FF" stroke-width="1" opacity="0.3" transform="rotate(60 16 16)"/>
      </svg>
    </div>
    <h1>Elastic Universe</h1>
    <p>This site is currently in preview. Enter the password to continue.</p>
    <form method="GET">
      <input type="password" name="password" placeholder="Password" autofocus required />
      <button type="submit">Enter</button>
    </form>
    ${errorHtml}
  </div>
</body>
</html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
    },
  );
}
