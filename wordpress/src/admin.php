<?php
/**
 * The settings page, under Settings > Fairtoll, where the publisher pastes or edits the config and turns logging on.
 *
 * @package Fairtoll
 */

namespace Fairtoll;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function add_settings_page(): void {
	add_options_page( 'Fairtoll', 'Fairtoll', 'manage_options', 'fairtoll', __NAMESPACE__ . '\render_settings_page' );
}

function register_settings(): void {
	// The config is kept as the text the publisher wrote, so a mistake in it can be shown and fixed. It is never
	// rewritten here, because changing the text could change the config.
	register_setting(
		'fairtoll',
		CONFIG_OPTION,
		array(
			'type'              => 'string',
			'default'           => '',
			'sanitize_callback' => function ( $value ): string {
				return is_string( $value ) ? $value : '';
			},
		)
	);
	register_setting(
		'fairtoll',
		LOG_OPTION,
		array(
			'type'              => 'boolean',
			'default'           => false,
			'sanitize_callback' => function ( $value ): bool {
				return (bool) $value;
			},
		)
	);
}

function render_settings_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$text = (string) get_option( CONFIG_OPTION, '' );
	try {
		$parsed = parse_config_json( $text );
	} catch ( \Throwable $e ) {
		// Screening throws the same way, so every request is let through. The page still shows, so the config can be fixed.
		$parsed = failed( array( error( 'config', 'could not be checked: ' . $e->getMessage() ) ) );
	}
	?>
	<div class="wrap">
		<h1>Fairtoll</h1>
		<p>
			<?php esc_html_e( 'Fairtoll sees AI bots and agents by their user-agent, and can block them on the paths you choose. The config is the same JSON the Fairtoll package takes. An empty config only observes.', 'fairtoll' ); ?>
			<a href="https://github.com/mechrabbit/fairtoll/tree/main/wordpress#readme"><?php esc_html_e( 'How to write one', 'fairtoll' ); ?></a>
		</p>
		<?php if ( ! $parsed['ok'] ) : ?>
			<div class="notice notice-error inline">
				<p><strong><?php esc_html_e( 'Fairtoll is letting every request through, because the config has these mistakes:', 'fairtoll' ); ?></strong></p>
				<ul>
					<?php foreach ( $parsed['errors'] as $error ) : ?>
						<li><code><?php echo esc_html( $error['field'] ); ?></code> <?php echo esc_html( $error['message'] ); ?></li>
					<?php endforeach; ?>
				</ul>
			</div>
		<?php elseif ( charges( $parsed['config'] ) ) : ?>
			<div class="notice notice-warning inline">
				<p><?php esc_html_e( 'The WordPress plugin can\'t charge yet, so AI requests to paths that charge are let through. They are logged with the action "charge".', 'fairtoll' ); ?></p>
			</div>
		<?php endif; ?>
		<form method="post" action="options.php">
			<?php settings_fields( 'fairtoll' ); ?>
			<p><label for="fairtoll-config"><strong><?php esc_html_e( 'Config', 'fairtoll' ); ?></strong></label></p>
			<textarea id="fairtoll-config" name="<?php echo esc_attr( CONFIG_OPTION ); ?>" rows="16" class="large-text code" placeholder='{ "rules": [{ "path": "/articles/*", "ai": "block" }] }'><?php echo esc_textarea( $text ); ?></textarea>
			<p>
				<label>
					<input type="checkbox" name="<?php echo esc_attr( LOG_OPTION ); ?>" value="1" <?php checked( (bool) get_option( LOG_OPTION ) ); ?>>
					<?php esc_html_e( 'Log each AI request to the PHP error log, as a line of JSON starting {"fairtoll":1', 'fairtoll' ); ?>
				</label>
			</p>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}
