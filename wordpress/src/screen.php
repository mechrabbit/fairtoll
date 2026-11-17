<?php
/**
 * Classifying a request and deciding what to do with it: a port of `classify` in src/core/classify.ts, `decide`
 * and `screen` in src/core/screen.ts, and src/core/paths.ts, which document why each step works as it does.
 * spec/screen-cases.json, which both versions are tested against, keeps them equal.
 *
 * @package Fairtoll
 */

namespace Fairtoll;

/**
 * User-agent tokens that AI crawlers and agents send. Anyone can send one, so a match is only a claim and never
 * makes a request verified. Tests keep this equal to spec/agents.json, as they do the TypeScript list.
 */
const AI_AGENTS = array(
	'GPTBot',
	'ChatGPT-User',
	'OAI-SearchBot',
	'ClaudeBot',
	'Claude-User',
	'Claude-SearchBot',
	'anthropic-ai',
	'PerplexityBot',
	'Perplexity-User',
	'Google-CloudVertexBot',
	'CCBot',
	'Bytespider',
	'Amazonbot',
	'meta-externalagent',
	'meta-externalfetcher',
	'cohere-ai',
	'MistralAI-User',
	'DuckAssistBot',
	'YouBot',
	'Diffbot',
);

/**
 * What to do with one request, and why, for the event log: `class`, `reason`, and `action`, which is "allow",
 * "block" or "charge".
 *
 * @param array       $config         A parsed config.
 * @param string      $method         The request's method.
 * @param string      $path           The path WordPress routes the request by, with no query string.
 * @param string|null $user_agent     The User-Agent header, or null when there is none.
 * @param bool        $asks_preflight Whether the request has an Access-Control-Request-Method header.
 */
function screen( array $config, string $method, string $path, ?string $user_agent, bool $asks_preflight ): array {
	list( $class, $reason ) = classify( $user_agent );
	// A browser's preflight always names the method it asks about, so an OPTIONS without one is charged.
	$preflight = 'OPTIONS' === $method && $asks_preflight;
	// robots.txt is always served, so a blocked crawler can still read the site's rules.
	$action = '/robots.txt' === $path ? 'allow' : decide( $config, $class, $preflight, $path );
	return array(
		'class'  => $class,
		'reason' => $reason,
		'action' => $action,
	);
}

/** The request's class and the reason for it, from its User-Agent header. */
function classify( ?string $user_agent ): array {
	$tokens = implode( '|', array_map( fn( $agent ) => preg_quote( $agent, '/' ), AI_AGENTS ) );
	if ( null !== $user_agent && preg_match( "/\\b({$tokens})\\b/i", $user_agent, $match ) ) {
		foreach ( AI_AGENTS as $agent ) {
			if ( strcasecmp( $agent, $match[1] ) === 0 ) {
				return array( 'unverifiedBot', "user-agent claims {$agent}" );
			}
		}
	}
	return array( 'human', 'no bot signals' );
}

/**
 * "allow", "block" or "charge" for an AI request: the most specific rule that matches the path, or the top-level
 * `ai` if none does. A human request is always allowed, and so is a CORS preflight when charging. When there are
 * rules and anything blocks or charges, an AI request whose path has a ".." segment is blocked.
 */
function decide( array $config, string $class, bool $preflight, string $path ): string {
	if ( 'human' === $class ) {
		return 'allow';
	}
	if ( $config['rules'] && ! allows_everything( $config ) && has_dot_dot_segment( $path ) ) {
		return 'block';
	}
	$policy = rule_for( $config['rules'], $path ) ?? $config;
	if ( 'charge' === $policy['ai'] && $preflight ) {
		return 'allow';
	}
	return $policy['ai'];
}

function allows_everything( array $config ): bool {
	foreach ( $config['rules'] as $rule ) {
		if ( 'allow' !== $rule['ai'] ) {
			return false;
		}
	}
	return 'allow' === $config['ai'];
}

/** True when the config sets anything to charge, which this version of the plugin can't do yet. */
function charges( array $config ): bool {
	foreach ( $config['rules'] as $rule ) {
		if ( 'charge' === $rule['ai'] ) {
			return true;
		}
	}
	return 'charge' === $config['ai'];
}

/**
 * The path in canonical form: percent-decoded once, lowercased, with backslashes as slashes, empty and "."
 * segments dropped, ".." segments resolved, and no trailing slash.
 */
function canonical_path( string $path ): string {
	$resolved = array();
	foreach ( decoded_segments( $path ) as $segment ) {
		if ( '..' === $segment ) {
			array_pop( $resolved );
		} else {
			$resolved[] = $segment;
		}
	}
	return '/' . implode( '/', $resolved );
}

/** A rule's path as `rule_for` matches it: an exact path, or one ending in "/*", in canonical form. */
function canonical_rule_path( string $path ): string {
	if ( substr( $path, -2 ) !== '/*' ) {
		return canonical_path( $path );
	}
	$prefix = canonical_path( substr( $path, 0, -2 ) );
	return '/' === $prefix ? '/*' : "{$prefix}/*";
}

/** The most specific rule that matches the path: an exact rule, then the wildcard with the longest prefix. */
function rule_for( array $rules, string $path ): ?array {
	if ( ! $rules ) {
		return null;
	}
	$canonical = canonical_path( $path );
	foreach ( $rules as $rule ) {
		if ( $rule['path'] === $canonical ) {
			return $rule;
		}
	}
	$best        = null;
	$best_length = -1;
	foreach ( $rules as $rule ) {
		if ( substr( $rule['path'], -2 ) !== '/*' ) {
			continue;
		}
		// "/premium/*" has the prefix "/premium", and "/*" has the prefix "", which covers every path.
		$prefix = substr( $rule['path'], 0, -2 );
		$covers = $canonical === $prefix || strpos( $canonical, "{$prefix}/" ) === 0;
		if ( $covers && strlen( $prefix ) > $best_length ) {
			$best        = $rule;
			$best_length = strlen( $prefix );
		}
	}
	return $best;
}

/** Whether the path has a ".." segment, written as it is, percent-encoded, or after a backslash. */
function has_dot_dot_segment( string $path ): bool {
	return in_array( '..', decoded_segments( $path ), true );
}

/** The path's segments, decoded and lowercased, with backslashes as slashes, and without empty or "." segments. */
function decoded_segments( string $path ): array {
	// Decoded once, one segment at a time, so a decoded %2f or %5c then splits its segment in two.
	$decoded = implode( '/', array_map( __NAMESPACE__ . '\decode_segment', explode( '/', $path ) ) );
	$lower   = mb_strtolower( str_replace( '\\', '/', $decoded ), 'UTF-8' );
	return array_values(
		array_filter(
			explode( '/', $lower ),
			function ( string $segment ): bool {
				return '' !== $segment && '.' !== $segment;
			}
		)
	);
}

/**
 * The segment percent-decoded, as JavaScript's `decodeURIComponent` does it, or the segment as it is when that
 * would fail: when a "%" isn't followed by two hex digits, or the bytes it decodes to aren't UTF-8.
 */
function decode_segment( string $segment ): string {
	if ( preg_match( '/%(?![0-9a-f]{2})/i', $segment ) ) {
		return $segment;
	}
	$decoded = rawurldecode( $segment );
	// The u modifier makes the match fail on bytes that aren't valid UTF-8.
	return preg_match( '//u', $decoded ) ? $decoded : $segment;
}
