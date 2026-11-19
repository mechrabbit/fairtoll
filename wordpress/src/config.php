<?php
/**
 * The config: a port of `parseConfig` in src/core/config.ts, which documents what each field means. It takes the
 * same JSON and gives the same errors, and spec/config-cases.json, which both versions are tested against, keeps
 * them equal.
 *
 * A parsed config is an array:
 * - `ai`: "allow", "block" or "charge", for paths no rule matches.
 * - `charge`: when `ai` is "charge", an array of `price`, `payTo` and `network`.
 * - `rules`: a list of arrays with a canonical `path`, an `ai`, and a `charge` when it charges.
 *
 * @package Fairtoll
 */

namespace Fairtoll;

use kornrunner\Keccak;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const KNOWN_FIELDS = array( 'ai', 'price', 'payTo', 'network', 'rules' );
const RULE_FIELDS  = array( 'path', 'ai', 'price' );
const NETWORKS     = array( 'base', 'base-sepolia' );

const AI_MESSAGE        = 'must be "allow", "block" or "charge"';
const NETWORK_MESSAGE   = 'must be one of "base", "base-sepolia"';
const PAY_TO_MESSAGE    = 'must be a wallet address other than the zero address: 0x and 40 hex digits, all in one case or with its EIP-55 checksum';
const RULE_PATH_MESSAGE = 'must be a path starting with "/", with "*" only as a final "/*", such as "/premium/*"';
const PRICE_MESSAGE     = 'must be a price in dollars above zero, with at most 6 decimals, written as a string such as "0.002"';

/**
 * The config saved in the settings page, which is JSON text. Empty text is `{}`, which only observes.
 *
 * @return array `['ok' => true, 'config' => array]` or `['ok' => false, 'errors' => list of ['field', 'message']]`.
 */
function parse_config_json( string $json ): array {
	if ( trim( $json ) === '' ) {
		return parse_config( new \stdClass() );
	}
	// Without $associative, so a JSON object is a stdClass and a JSON array is a PHP array, as they are in JavaScript.
	$input = json_decode( $json );
	if ( json_last_error() !== JSON_ERROR_NONE ) {
		return failed( array( error( 'config', 'must be valid JSON: ' . json_last_error_msg() ) ) );
	}
	return parse_config( $input );
}

/**
 * Like `parseConfig`, every field is first checked on its own, and every error is reported. Only when every field
 * is valid is it checked that whatever charges has the fields it needs.
 *
 * @param mixed $input The config as `json_decode` returns it without $associative.
 */
function parse_config( $input ): array {
	if ( ! $input instanceof \stdClass ) {
		return failed( array( error( 'config', 'must be a plain object' ) ) );
	}
	$errors  = unknown_field_errors( $input, KNOWN_FIELDS, '' );
	$ai      = read_field( $input, 'ai', __NAMESPACE__ . '\is_ai', AI_MESSAGE, 'ai', $errors );
	$price   = read_field( $input, 'price', __NAMESPACE__ . '\is_price', PRICE_MESSAGE, 'price', $errors );
	$pay_to  = read_field( $input, 'payTo', __NAMESPACE__ . '\is_wallet_address', PAY_TO_MESSAGE, 'payTo', $errors );
	$network = read_field( $input, 'network', __NAMESPACE__ . '\is_network', NETWORK_MESSAGE, 'network', $errors );
	$rules   = parse_rules( present_value( $input, 'rules' ), $errors );
	if ( $errors ) {
		return failed( $errors );
	}
	return to_config( $ai ?? 'allow', $price, $pay_to, $network, $rules );
}

/**
 * The config, or an error for each charge field that something charging needs and the config leaves out, as in
 * `toConfig`. Every charge is paid to the top-level `payTo` on the top-level `network`, so an error for either is
 * listed once however many policies charge.
 */
function to_config( string $ai, ?string $price, ?string $pay_to, ?string $network, array $rules ): array {
	$needed_by          = 'charge' === $ai ? 'is needed when ai is "charge"' : 'is needed when a rule\'s ai is "charge"';
	$destination_errors = array();
	if ( null === $pay_to ) {
		$destination_errors[] = error( 'payTo', $needed_by );
	}
	if ( null === $network ) {
		$destination_errors[] = error( 'network', $needed_by );
	}
	$policy = function ( string $ai, ?string $price, array $no_price, array &$errors ) use ( $pay_to, $network, $destination_errors ): array {
		if ( 'charge' !== $ai ) {
			return array( 'ai' => $ai );
		}
		$missing = array_merge( null === $price ? array( $no_price ) : array(), $destination_errors );
		foreach ( $missing as $error ) {
			if ( ! in_array( $error, $errors, true ) ) {
				$errors[] = $error;
			}
		}
		return array(
			'ai'     => 'charge',
			'charge' => array(
				'price'   => $price,
				'payTo'   => $pay_to,
				'network' => $network,
			),
		);
	};

	$errors = array();
	$config = $policy( $ai, $price, error( 'price', 'is needed when ai is "charge"' ), $errors );

	$config['rules'] = array();
	foreach ( $rules as $rule ) {
		$no_price          = error( "{$rule['at']}.price", 'is needed when the rule\'s ai is "charge" and there is no top-level price' );
		$config['rules'][] = array( 'path' => $rule['path'] ) + $policy( $rule['ai'], $rule['price'] ?? $price, $no_price, $errors );
	}
	return $errors ? failed( $errors ) : array(
		'ok'     => true,
		'config' => $config,
	);
}

/**
 * The rules as written, each with `at` (such as "rules[0]"), a canonical `path`, an `ai` and its own `price` or
 * null. Errors are added to $errors, as in `parseRules`. A missing or null `rules` is no rules.
 *
 * @param mixed $value The config's `rules`.
 */
function parse_rules( $value, array &$errors ): array {
	if ( null === $value ) {
		return array();
	}
	if ( ! is_array( $value ) ) {
		$errors[] = error( 'rules', 'must be an array of rules' );
		return array();
	}
	$rules = array();
	// The canonical path of each rule so far, and the rule's index, to find two rules for the same paths.
	$seen = array();
	foreach ( $value as $index => $item ) {
		$at = "rules[{$index}]";
		if ( ! $item instanceof \stdClass ) {
			$errors[] = error( $at, 'must be a plain object' );
			continue;
		}
		array_push( $errors, ...unknown_field_errors( $item, RULE_FIELDS, "{$at}." ) );
		$path  = read_field( $item, 'path', __NAMESPACE__ . '\is_rule_path', RULE_PATH_MESSAGE, "{$at}.path", $errors, true );
		$ai    = read_field( $item, 'ai', __NAMESPACE__ . '\is_ai', AI_MESSAGE, "{$at}.ai", $errors, true );
		$price = read_field( $item, 'price', __NAMESPACE__ . '\is_price', PRICE_MESSAGE, "{$at}.price", $errors );
		if ( null === $path ) {
			continue;
		}
		$canonical = canonical_rule_path( $path );
		if ( isset( $seen[ $canonical ] ) ) {
			$errors[] = error( "{$at}.path", "matches the same paths as rules[{$seen[ $canonical ]}]" );
		} else {
			$seen[ $canonical ] = $index;
		}
		// When $ai is null there is an error, so the rule is never used.
		$rules[] = array(
			'at'    => $at,
			'path'  => $canonical,
			'ai'    => $ai ?? 'allow',
			'price' => $price,
		);
	}
	return $rules;
}

/**
 * The field's value when `$valid` accepts it, or null when it is missing or invalid. An invalid field, or a
 * missing one that is `$required`, adds an error naming `$error_field` to $errors.
 */
function read_field( \stdClass $input, string $name, callable $valid, string $message, string $error_field, array &$errors, bool $required = false ) {
	$value = present_value( $input, $name );
	if ( null === $value ) {
		if ( $required ) {
			$errors[] = error( $error_field, 'is needed in every rule' );
		}
		return null;
	}
	if ( $valid( $value ) ) {
		return $value;
	}
	$errors[] = error( $error_field, $message );
	return null;
}

/**
 * The field's own value, or null when it is missing. A null field is the same as leaving it out.
 *
 * @return mixed
 */
function present_value( \stdClass $input, string $name ) {
	return property_exists( $input, $name ) ? $input->$name : null;
}

function unknown_field_errors( \stdClass $input, array $known, string $prefix ): array {
	$errors = array();
	foreach ( array_keys( get_object_vars( $input ) ) as $name ) {
		// A key such as "1" comes back as an integer.
		if ( ! in_array( (string) $name, $known, true ) ) {
			$errors[] = error( "{$prefix}{$name}", 'is not a known field' );
		}
	}
	return $errors;
}

/** @param mixed $value */
function is_ai( $value ): bool {
	return in_array( $value, array( 'allow', 'block', 'charge' ), true );
}

/** @param mixed $value */
function is_network( $value ): bool {
	return in_array( $value, NETWORKS, true );
}

/**
 * The patterns end in `$/D`, because without D a `$` also matches before a final newline, which JavaScript's
 * doesn't.
 *
 * @param mixed $value
 */
function is_price( $value ): bool {
	return is_string( $value ) && preg_match( '/^\d+(\.\d{1,6})?$/D', $value ) && preg_match( '/[1-9]/', $value );
}

/**
 * An exact path, or one ending in "/*". A "%2A" is refused, because it decodes to a "*".
 *
 * @param mixed $value
 */
function is_rule_path( $value ): bool {
	if ( ! is_string( $value ) || preg_match( '/%2a/i', $value ) ) {
		return false;
	}
	return preg_match( '/^\/[^*]*$/D', $value ) || preg_match( '/^\/([^*]*\/)?\*$/D', $value );
}

/**
 * An address in one case has no checksum. A mixed-case one must carry its EIP-55 checksum, so a typo that would
 * send payments to the wrong wallet is caught. The zero address is a placeholder no payment can reach.
 *
 * @param mixed $value
 */
function is_wallet_address( $value ): bool {
	if ( ! is_string( $value ) || preg_match( '/^0x0{40}$/D', $value ) ) {
		return false;
	}
	if ( preg_match( '/^0x([0-9a-f]{40}|[0-9A-F]{40})$/D', $value ) ) {
		return true;
	}
	return preg_match( '/^0x[0-9a-fA-F]{40}$/D', $value ) && checksum_address( $value ) === $value;
}

/**
 * The address with its EIP-55 checksum: each letter is upper case where the same position in the Keccak-256 hash
 * of the lower-case hex is 8 or more.
 */
function checksum_address( string $address ): string {
	$hex      = strtolower( substr( $address, 2 ) );
	$hash     = Keccak::hash( $hex, 256 );
	$checksum = '0x';
	for ( $i = 0; $i < 40; $i++ ) {
		$checksum .= hexdec( $hash[ $i ] ) >= 8 ? strtoupper( $hex[ $i ] ) : $hex[ $i ];
	}
	return $checksum;
}

function error( string $field, string $message ): array {
	return array(
		'field'   => $field,
		'message' => $message,
	);
}

function failed( array $errors ): array {
	return array(
		'ok'     => false,
		'errors' => $errors,
	);
}
