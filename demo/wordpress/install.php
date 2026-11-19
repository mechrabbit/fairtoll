<?php
// Installs the demo site: php demo/wordpress/install.php <site directory> <site URL>
// It has the sample page and post every new WordPress has, pretty permalinks, and Fairtoll active, with logging on
// and the config in demo/wordpress/config.json.
list( , $site, $url ) = $argv;
define( 'WP_INSTALLING', true );
$_SERVER['HTTP_HOST'] = parse_url( $url, PHP_URL_HOST );
require $site . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
wp_install( 'Fairtoll demo', 'demo', 'demo@example.com', false, '', 'demo' );
update_option( 'siteurl', $url );
update_option( 'home', $url );
update_option( 'permalink_structure', '/%postname%/' );
update_option( 'fairtoll_config', file_get_contents( __DIR__ . '/config.json' ) );
update_option( 'fairtoll_log', true );
activate_plugin( 'fairtoll/fairtoll.php' );
echo "Installed WordPress at $url\n";
