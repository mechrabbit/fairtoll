#!/bin/sh
# Builds fairtoll.zip, the plugin with its Composer dependencies, which installs from wp-admin under Plugins >
# Add New Plugin > Upload Plugin, and which wordpress-deploy.yml publishes to WordPress.org. Run from the repo root:
#   sh wordpress/build-zip.sh
set -e
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
mkdir "$build/fairtoll"
cp -R wordpress/fairtoll.php wordpress/uninstall.php wordpress/readme.txt wordpress/src wordpress/composer.json wordpress/composer.lock \
	"$build/fairtoll/"
composer install --working-dir="$build/fairtoll" --no-dev --no-interaction --quiet
rm -f fairtoll.zip
(cd "$build" && zip -qr - fairtoll) > fairtoll.zip
echo "Built fairtoll.zip"
