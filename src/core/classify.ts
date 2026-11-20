import type { RequestClass } from "./types.js";

/**
 * User-agent tokens that AI crawlers and agents send. Anyone can send one, so a match is
 * only a claim and never makes a request verified.
 */
const aiAgents = [
	"GPTBot",
	"ChatGPT-User",
	"OAI-SearchBot",
	"ClaudeBot",
	"Claude-User",
	"Claude-SearchBot",
	"anthropic-ai",
	"PerplexityBot",
	"Perplexity-User",
	"Google-CloudVertexBot",
	"CCBot",
	"Bytespider",
	"Amazonbot",
	"meta-externalagent",
	"meta-externalfetcher",
	"cohere-ai",
	"MistralAI-User",
	"DuckAssistBot",
	"YouBot",
	"Diffbot",
];
const aiAgentPattern = new RegExp(`\\b(${aiAgents.join("|")})\\b`, "i");
const canonicalAgent = new Map(aiAgents.map((agent) => [agent.toLowerCase(), agent]));

export interface Classification {
	readonly class: RequestClass;
	/** Why the request got its class, for the event log. */
	readonly reason: string;
	/** The AI bot or agent the user-agent names, such as "GPTBot", when it names one. */
	readonly bot?: string;
}

export function classify(request: Request): Classification {
	const match = aiAgentPattern.exec(request.headers.get("user-agent") ?? "")?.[1];
	const claimed = match && canonicalAgent.get(match.toLowerCase());
	if (claimed) return { class: "unverifiedBot", reason: `user-agent claims ${claimed}`, bot: claimed };
	return { class: "human", reason: "no bot signals" };
}
