<?php
/**
 * Runs the cases in spec/, which the TypeScript core's tests run too, so the two versions can't drift apart
 * without one of them failing.
 *
 * @package Fairtoll
 */

use PHPUnit\Framework\TestCase;

final class SpecTest extends TestCase {
	/**
	 * A file in spec/, decoded without $associative, so each config is what the plugin gets from the settings page.
	 *
	 * @return mixed
	 */
	private static function spec( string $name ) {
		return json_decode( file_get_contents( __DIR__ . "/../../spec/{$name}" ), false, 512, JSON_THROW_ON_ERROR );
	}

	public function test_the_ai_agent_list_is_the_one_in_spec(): void {
		$this->assertSame( self::spec( 'agents.json' ), Fairtoll\AI_AGENTS );
	}

	public static function config_cases(): array {
		$cases = array();
		foreach ( self::spec( 'config-cases.json' ) as $case ) {
			$cases[ $case->name ] = array( $case->config, array_map( 'get_object_vars', $case->errors ) );
		}
		return $cases;
	}

	/**
	 * @dataProvider config_cases
	 * @param mixed $config
	 */
	public function test_config_case( $config, array $errors ): void {
		$result = Fairtoll\parse_config( $config );
		$this->assertSame( $errors, $result['ok'] ? array() : $result['errors'] );
	}

	public static function screen_cases(): array {
		$cases = array();
		foreach ( self::spec( 'screen-cases.json' ) as $group ) {
			foreach ( $group->requests as $request ) {
				$cases[ $request->name ] = array( $group->config, $request );
			}
		}
		return $cases;
	}

	/** @dataProvider screen_cases */
	public function test_screen_case( stdClass $config, stdClass $request ): void {
		$parsed = Fairtoll\parse_config( $config );
		$this->assertTrue( $parsed['ok'], 'the config is valid' );
		$screened = Fairtoll\screen( $parsed['config'], $request->method, $request->path, $request->userAgent, $request->preflight );
		$expected = array(
			'class'  => $request->class,
			'reason' => $request->reason,
			'action' => $request->action,
		);
		$this->assertSame( $expected, $screened );
	}
}
