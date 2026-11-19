<?php
// The plugin's files exit unless ABSPATH is defined, as it is inside WordPress.
define( 'ABSPATH', __DIR__ . '/' );

// The parts of the plugin that don't need WordPress, which is everything the tests cover.
require __DIR__ . '/../vendor/autoload.php';
require __DIR__ . '/../src/config.php';
require __DIR__ . '/../src/screen.php';
