// Each endpoint answers any request under it with its method, path, and body, so a changed response is easy to
// see. Any other path gets a 404 listing the endpoints.
const endpoints = ["/open", "/monitor", "/blocked", "/charged"];

async function answer(request) {
	const { pathname } = new URL(request.url);
	if (!endpoints.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
		return new Response(`Send requests under one of the endpoints: ${endpoints.join(", ")}\n`, { status: 404 });
	}
	const body = await request.text();
	return new Response(`${request.method} ${pathname}${body ? `\n${body}` : ""}\n`);
}

export { answer as GET, answer as POST, answer as PUT, answer as PATCH, answer as DELETE };
