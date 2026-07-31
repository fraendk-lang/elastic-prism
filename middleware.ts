/**
 * Elastic Prism — Password Gate (Vercel Edge Middleware)
 * Set SITE_PASSWORD in Vercel → Project → Environment Variables.
 * Leave unset or empty → no protection.
 */

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|assets/).*)',
};

const COOKIE_NAME = 'eu-auth';

function grantAccess(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: path || '/',
      'Set-Cookie': `${COOKIE_NAME}=granted; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}; Path=/`,
    },
  });
}

function isDemoBypass(url: URL): boolean {
  return url.searchParams.get('demo') === '1' || url.searchParams.get('embed') === '1';
}

function getPasswordPage(error = false) {
  const errorHtml = error ? '<p class="error">Incorrect password</p>' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Elastic Prism — Access</title>
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
    input:focus { border-color: #D4A537; }
    button {
      padding: 12px 20px; border-radius: 12px; border: none;
      background: #D4A537; color: #000; font-weight: 600; font-size: 14px;
      cursor: pointer; transition: opacity 0.2s;
    }
    button:hover { opacity: 0.85; }
    .error { color: #f87171; font-size: 12px; margin-top: 12px; margin-bottom: 0; }
    .demo-link { display: block; margin-top: 20px; font-size: 13px; color: #888; text-decoration: none; }
    .demo-link:hover { color: #D4A537; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin:0 auto">
        <circle cx="16" cy="16" r="3" fill="#D4A537" opacity="0.8"/>
        <ellipse cx="16" cy="16" rx="12" ry="6" fill="none" stroke="#D4A537" stroke-width="1" opacity="0.5"/>
        <ellipse cx="16" cy="16" rx="12" ry="6" fill="none" stroke="#8B6914" stroke-width="1" opacity="0.3" transform="rotate(60 16 16)"/>
      </svg>
    </div>
    <h1>Elastic Prism</h1>
    <p>This site is currently in preview. Enter the password to continue.</p>
    <form id="gateForm">
      <input type="password" id="gatePasswordInput" placeholder="Password" autofocus required autocomplete="current-password" />
      <button type="submit">Enter</button>
    </form>
    <a class="demo-link" href="/?demo=1">Try demo without password →</a>
    <script>
      document.getElementById('gateForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var password = document.getElementById('gatePasswordInput').value;
        var res = await fetch(window.location.pathname || '/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password })
        });
        if (res.redirected) {
          window.location.href = res.url;
          return;
        }
        if (res.ok) {
          window.location.href = '/';
          return;
        }
        window.location.reload();
      });
    </script>
    ${errorHtml}
  </div>
</body>
</html>`;
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  const password = (process.env.SITE_PASSWORD || '').trim();
  if (!password) return;

  const url = new URL(request.url);
  const path = url.pathname;
  if (
    path.startsWith('/assets') ||
    path === '/manifest.json' ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.json') ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.ico') ||
    path.endsWith('.woff2')
  ) {
    return;
  }

  const cookies = request.headers.get('cookie') || '';
  const hasAuth = cookies.split(';').some(c => c.trim().startsWith(`${COOKIE_NAME}=granted`));
  if (hasAuth) return;

  if (isDemoBypass(url)) {
    return grantAccess(path || '/');
  }

  let submitted: string | null | undefined;
  if (request.method === 'POST') {
    try {
      const body = await request.json() as { password?: string };
      submitted = body?.password;
    } catch {
      submitted = undefined;
    }
  } else {
    submitted = url.searchParams.get('password');
  }

  if (submitted === password) {
    return grantAccess(path || '/');
  }

  const hasError = submitted !== undefined && submitted !== null && submitted !== password;
  return new Response(getPasswordPage(hasError), {
    status: 200,
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
  });
}
