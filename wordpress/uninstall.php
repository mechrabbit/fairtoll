<?php
/**
 * Removes the plugin's options when it is deleted from wp-admin.
 *
 * @package Fairtoll
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'fairtoll_config' );
delete_option( 'fairtoll_log' );
