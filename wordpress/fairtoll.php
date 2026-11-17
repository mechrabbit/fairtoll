<?php
/**
 * Plugin Name:       Fairtoll
 * Plugin URI:        https://github.com/mechrabbit/fairtoll
 * Description:       See and block AI bot and agent traffic on your site. It only observes until you change its config.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           Apache-2.0
 * License URI:       https://www.apache.org/licenses/LICENSE-2.0
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
add_action( 'plugins_loaded', __NAMESPACE__ . '\handle_request', 0 );

if ( is_admin() ) {
	require_once __DIR__ . '/src/admin.php';
	add_action( 'admin_menu', __NAMESPACE__ . '\add_settings_page' );
	add_action( 'admin_init', __NAMESPACE__ . '\register_settings' );
}

/**
 * Screens the request, logs the decision when logging is on, and answers a request the config blocks with a 403.
 * Every other request, including one a rule charges, carries on to WordPress unchanged. It fails open: when the
 * config is invalid or a step throws, the request carries on as if Fairtoll weren't installed.
 */
function handle_request(): void {
	if ( PHP_SAPI === 'cli' || ! isset( $_SERVER['REQUEST_URI'] ) ) {
		return;
	}
	try {
		$parsed = parse_config_json( (string) get_option( CONFIG_OPTION, '' ) );
		if ( ! $parsed['ok'] ) {
			// The settings page shows the errors.
			return;
		}
		// The path WordPress routes by, without the query string. It isn't decoded, so a rule matches it as it
		// would a path in the Express adapter.
		$path       = explode( '?', (string) $_SERVER['REQUEST_URI'], 2 )[0];
		$method     = (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' );
		$user_agent = isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) $_SERVER['HTTP_USER_AGENT'] : null;
		$screened   = screen( $parsed['config'], $method, $path, $user_agent, isset( $_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD'] ) );
	} catch ( \Throwable $e ) {
		error_log( 'fairtoll: screening a request failed, so the request was passed through unscreened: ' . $e->getMessage() );
		return;
	}
	// A human request isn't logged, because that would add a line to the log for every page view.
	if ( 'human' !== $screened['class'] && get_option( LOG_OPTION ) ) {
		log_event( $path, $screened );
	}
	if ( 'block' === $screened['action'] ) {
		// The 403 depends on the user-agent, so a shared cache must not replay it to other visitors.
		http_response_code( 403 );
		header( 'Cache-Control: no-store' );
		header( 'Content-Type: text/plain; charset=utf-8' );
		echo "This site does not allow AI bots or agents.\n";
		exit;
	}
}

/**
 * Writes one line to the PHP error log, in the same format as the TypeScript core's `DecisionEvent`. A path that
 * isn't valid UTF-8 is logged with its invalid bytes replaced, so the line is always valid JSON. Logging never
 * changes what happens to the request.
 */
function log_event( string $path, array $screened ): void {
	try {
		$now   = microtime( true );
		$event = array(
			'fairtoll' => 1,
			'time'     => gmdate( 'Y-m-d\TH:i:s', (int) $now ) . sprintf( '.%03dZ', ( $now - floor( $now ) ) * 1000 ),
			'path'     => $path,
			'class'    => $screened['class'],
			'reason'   => $screened['reason'],
			'action'   => $screened['action'],
		);
		error_log( json_encode( $event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR ) );
	} catch ( \Throwable $e ) {
		error_log( 'fairtoll: logging a request failed, so its event was lost: ' . $e->getMessage() );
	}
}
