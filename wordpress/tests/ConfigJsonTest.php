<?php
/**
 * The settings page saves the config as JSON text, which the TypeScript core never sees.
 *
 * @package Fairtoll
 */

use PHPUnit\Framework\TestCase;

final class ConfigJsonTest extends TestCase {
	public function test_empty_text_only_observes(): void {
		$expected = array(
			'ok'     => true,
			'config' => array(
				'ai'    => 'allow',
				'rules' => array(),
			),
		);
		$this->assertSame( $expected, Fairtoll\parse_config_json( '' ) );
		$this->assertSame( $expected, Fairtoll\parse_config_json( " \n" ) );
	}

	public function test_text_that_is_not_json_is_an_error(): void {
		$result = Fairtoll\parse_config_json( '{"ai": "block",}' );
		$this->assertSame( array( array( 'field' => 'config', 'message' => 'must be valid JSON: Syntax error' ) ), $result['errors'] );
	}

	public function test_a_parsed_config_has_its_charges_and_canonical_rule_paths(): void {
		$wallet = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
		$json   = json_encode(
			array(
				'price'   => '0.002',
				'payTo'   => $wallet,
				'network' => 'base',
				'rules'   => array(
					array( 'path' => '/Premium/*', 'ai' => 'charge', 'price' => '0.01' ),
					array( 'path' => '/news/', 'ai' => 'charge' ),
					array( 'path' => '/private/*', 'ai' => 'block' ),
				),
			)
		);
		$charge   = fn( $price ) => array( 'price' => $price, 'payTo' => $wallet, 'network' => 'base' );
		$expected = array(
			'ai'    => 'allow',
			'rules' => array(
				array( 'path' => '/premium/*', 'ai' => 'charge', 'charge' => $charge( '0.01' ) ),
				array( 'path' => '/news', 'ai' => 'charge', 'charge' => $charge( '0.002' ) ),
				array( 'path' => '/private/*', 'ai' => 'block' ),
			),
		);
		$this->assertSame( array( 'ok' => true, 'config' => $expected ), Fairtoll\parse_config_json( $json ) );
	}
}
