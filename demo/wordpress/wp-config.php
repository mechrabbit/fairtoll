<?php
// The demo site's config. The database is SQLite, in wp-content/database, so these DB_ values aren't used.
define( 'DB_NAME', 'demo' );
define( 'DB_USER', 'demo' );
define( 'DB_PASSWORD', 'demo' );
define( 'DB_HOST', 'localhost' );
// Fixed keys are fine for a site that only runs on this machine.
foreach ( array( 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT' ) as $name ) {
	define( $name, "fairtoll demo $name" );
}
$table_prefix = 'wp_';
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
