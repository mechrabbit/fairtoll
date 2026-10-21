export function origin(request) {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/missing/")) return new Response("not found", { status: 404 });
  return new Response(`content of ${pathname}`, { headers: { "content-type": "text/plain" } });
}
