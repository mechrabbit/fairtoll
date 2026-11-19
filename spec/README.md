# Shared test cases

The TypeScript package and the WordPress plugin in `wordpress/` implement the same config and the same decisions in two languages. These files hold cases both test suites run, `test/node/spec.test.ts` with vitest and `wordpress/tests/SpecTest.php` with PHPUnit, so a change that makes them disagree fails on both sides.

- `agents.json` is the list of AI user-agent tokens. Each version has its own copy in code, which its tests check against this one.
- `config-cases.json` gives each config, as the publisher writes it, the errors it gets, in order. A valid config gets none.
- `screen-cases.json` gives, for each config, requests by method, path, user-agent, and whether it is a CORS preflight, and the class, reason and action each one gets.

To change what Fairtoll does, change the cases here first, then both versions.
