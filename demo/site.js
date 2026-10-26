// The site and visitors that the demo commands share.
import express from "express";

/** Known visitors' real user-agent strings, so a demo user can name a visitor instead of knowing its string. */
export const visitors = {
	Chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	"Safari on iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
	Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
	GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
	"ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
	ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
	PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
	CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
};
/** A site that answers any request with its method, path, and body, so a changed response is easy to see. */
export function site(middleware) {
	const app = express();
	app.use((_req, res, next) => {
		// The Date header changes every second, so leave it out to keep demo output the same on every run.
		res.sendDate = false;
		next();
	});
	if (middleware) app.use(middleware);
	app.use(express.text({ type: "*/*" }), (req, res) => {
		res.send(`${req.method} ${req.path}${typeof req.body === "string" && req.body ? `\n${req.body}` : ""}`);
	});
	return app;
}
