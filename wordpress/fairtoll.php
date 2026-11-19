<?php
/**
 * Plugin Name:       Fairtoll
 * Plugin URI:        https://github.com/mechrabbit/fairtoll
 * Description:       See and block AI bot and agent traffic on your site. It only observes until you change its config.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       fairtoll
 *
 * @package Fairtoll
 */

namespace Fairtoll;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const CONFIG_OPTION = 'fairtoll_config';
const LOG_OPTION    = 'fairtoll_log';

// A copy without its Composer dependencies, such as a git checkout, would otherwise stop every page with a fatal
// error. Without them a request fails to screen, which lets it through.
if ( is_readable( __DIR__ . '/vendor/autoload.php' ) ) {
	require_once __DIR__ . '/vendor/autoload.php';
}
require_once __DIR__ . '/src/config.php';
require_once __DIR__ . '/src/screen.php';

// Before any theme or page code runs, so a blocked request costs as little as it can.
add_action( 'plugins_loaded', __NAMESPACE__ . '\screen_request', 0 );
// WordPress also picks what to serve from the query string, such as /?page_id=2 or /?rest_route=/wp/v2/pages/2,
// which a rule for the page's path doesn't match. So an AI request is screened again on the path of what WordPress
// resolved: its REST route, and the permalink of the post or page it serves. Both run before anything is served.
add_action( 'parse_request', __NAMESPACE__ . '\screen_rest_route', 0 );
add_action( 'template_redirect', __NAMESPACE__ . '\screen_resolved_post', 0 );

if ( is_admin() ) {
	require_once __DIR__ . '/src/admin.php';
	add_action( 'admin_menu', __NAMESPACE__ . '\add_settings_page' );
	add_action( 'admin_init', __NAMESPACE__ . '\register_settings' );
}

/**
 * Screens the request by its path, and answers a request the config blocks with a 403. Every other request,
 * including one a rule charges, carries on to WordPress, which may screen it again (see `screen_again`). It fails
 * open: when the config is invalid or a step throws, the request carries on as if Fairtoll weren't installed.
 */
function screen_request(): void {
	if ( PHP_SAPI === 'cli' || ! isset( $_SERVER['REQUEST_URI'] ) ) {
		return;
	}
	try {
		$user_agent = server_value( 'HTTP_USER_AGENT' );
		// A human request is always allowed and isn't logged, because that would add a line to the log for every
		// page view. So it skips reading the config.
		if ( 'human' === classify( $user_agent )[0] ) {
			return;
		}
		$parsed = parse_config_json( (string) get_option( CONFIG_OPTION, '' ) );
		if ( ! $parsed['ok'] ) {
			// The settings page shows the errors.
			return;
		}
		$request = array(
			'config'     => $parsed['config'],
			'method'     => server_value( 'REQUEST_METHOD' ) ?? 'GET',
			// The path WordPress routes by, without the query string. It isn't decoded, so a rule matches it as it
			// would a path in the Express adapter.
			'path'       => explode( '?', (string) server_value( 'REQUEST_URI' ), 2 )[0],
			'user_agent' => $user_agent,
			'preflight'  => isset( $_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD'] ),
		);
		$request['screened'] = screen( $request['config'], $request['method'], $request['path'], $user_agent, $request['preflight'] );
	} catch ( \Throwable $e ) {
		write_log( 'fairtoll: screening a request failed, so the request was passed through unscreened: ' . $e->getMessage() );
		return;
	}
	ai_request( $request );
	// At shutdown, so the event has the request's final action, even when a later screen blocks it and exits.
	if ( get_option( LOG_OPTION ) ) {
		register_shutdown_function( __NAMESPACE__ . '\log_event' );
	}
	if ( 'block' === $request['screened']['action'] ) {
		block();
	}
}

/**
 * Screens a REST request on its route's path, such as /wp-json/wp/v2/pages/2, also when it came as ?rest_route=.
 *
 * @param \WP $wp Not type-hinted, so anything unexpected throws inside screen_again, which fails open.
 */
function screen_rest_route( $wp ): void {
	screen_again(
		function () use ( $wp ): ?string {
			if ( empty( $wp->query_vars['rest_route'] ) ) {
				return null;
			}
			// home_url's path is the subdirectory WordPress is installed in, if any, as it is in the REST API's URLs.
			$home = untrailingslashit( (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH ) );
			return $home . '/' . rest_get_url_prefix() . '/' . ltrim( (string) $wp->query_vars['rest_route'], '/' );
		}
	);
}

/**
 * Screens a request for a post or page, including its feed or embed and the page that lists the posts, on the path
 * of its permalink.
 */
function screen_resolved_post(): void {
	screen_again(
		function (): ?string {
			$post = get_queried_object();
			if ( ! $post instanceof \WP_Post ) {
				return null;
			}
			$permalink = get_permalink( $post );
			$parts     = is_string( $permalink ) ? wp_parse_url( $permalink ) : false;
			// A plain permalink, such as /?p=1, picks the post in its query string, so its path names no post.
			if ( ! is_array( $parts ) || ! isset( $parts['path'] ) || isset( $parts['query'] ) ) {
				return null;
			}
			return $parts['path'];
		}
	);
}

/**
 * Screens an AI request again, on the path that `$resolve` returns, or not at all when it returns null. The request
 * keeps the stronger of its two actions, block, then charge, then allow, and is answered with a 403 if that is
 * block. It fails open like `screen_request`.
 *
 * @param callable(): ?string $resolve
 */
function screen_again( callable $resolve ): void {
	$request = ai_request();
	if ( null === $request ) {
		return;
	}
	try {
		$path = $resolve();
		if ( null === $path ) {
			return;
		}
		$screened = screen( $request['config'], $request['method'], $path, $request['user_agent'], $request['preflight'] );
	} catch ( \Throwable $e ) {
		write_log( 'fairtoll: screening a request again failed, so the request was passed through: ' . $e->getMessage() );
		return;
	}
	$strength = array(
		'allow'  => 0,
		'charge' => 1,
		'block'  => 2,
	);
	if ( $strength[ $screened['action'] ] <= $strength[ $request['screened']['action'] ] ) {
		return;
	}
	$request['screened'] = $screened;
	ai_request( $request );
	if ( 'block' === $screened['action'] ) {
		block();
	}
}

/**
 * The AI request being served, as `screen_request` found it, or null when the request is human or unscreened.
 * Passing a request records it.
 */
function ai_request( ?array $record = null ): ?array {
	static $request = null;
	if ( null !== $record ) {
		$request = $record;
	}
	return $request;
}

/** Answers the request with a 403 and stops. */
function block(): void {
	// Once output has started, the status and headers can't be set, and a 200 with the block message could be
	// cached and shown to readers.
	if ( headers_sent() ) {
		write_log( 'fairtoll: a blocked request was let through, because output had already started, so the 403 could not be sent' );
		// So the event says what happened to the request.
		$request                       = ai_request();
		$request['screened']['action'] = 'allow';
		ai_request( $request );
		return;
	}
	// The 403 depends on the user-agent, so a shared cache must not replay it to other visitors.
	// status_header, because once WordPress has sent its own status line, http_response_code changes only the code
	// PHP logs, and the client still gets WordPress's 200.
	status_header( 403 );
	header( 'Cache-Control: no-store' );
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo "This site does not allow AI bots or agents.\n";
	exit;
}

/**
 * Writes one line to the PHP error log, in the same format as the TypeScript core's `DecisionEvent`. A path that
 * isn't valid UTF-8 is logged with its invalid bytes replaced, so the line is always valid JSON. Logging never
 * changes what happens to the request.
 */
function log_event(): void {
	try {
		$request  = ai_request();
		$screened = $request['screened'];
		$now      = microtime( true );
		$event    = array(
			'fairtoll' => 1,
			'time'     => gmdate( 'Y-m-d\TH:i:s', (int) $now ) . sprintf( '.%03dZ', ( $now - floor( $now ) ) * 1000 ),
			'path'     => $request['path'],
			'class'    => $screened['class'],
			'reason'   => $screened['reason'],
			'action'   => $screened['action'],
		);
		write_log( wp_json_encode( $event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR ) );
	} catch ( \Throwable $e ) {
		write_log( 'fairtoll: logging a request failed, so its event was lost: ' . $e->getMessage() );
	}
}

/**
 * A value from `$_SERVER`, such as a request header, exactly as the server gave it. It isn't unslashed, because it's
 * read at plugins_loaded, before WordPress adds slashes to `$_SERVER`. It isn't sanitized, because rules match the
 * path as it was sent, as they do in the Express adapter. It is only compared, and written to the log as JSON, never
 * output to a page.
 */
function server_value( string $name ): ?string {
	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- Read raw on purpose, as the comment above says.
	return isset( $_SERVER[ $name ] ) ? (string) $_SERVER[ $name ] : null;
}

/** Writes a line to the PHP error log, where the plugin reports its events and its failures. */
function write_log( string $line ): void {
	error_log( $line ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- The log is the plugin's output.
}
