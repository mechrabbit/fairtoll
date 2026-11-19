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
composer install --working-dir="$build/fairtoll" --no-dev --prefer-dist --no-interaction --quiet
# The dependencies' own tests, CI configs and hidden files, which the plugin doesn't run and Plugin Check rejects.
find "$build/fairtoll/vendor" \( -name '.*' -o -name test -o -name tests -o -name 'phpunit.xml*' -o -name 'infection.json*' \
	-o -name appveyor.yml -o -name composer.lock \) -prune -exec rm -rf {} +
rm -f fairtoll.zip
(cd "$build" && zip -qr - fairtoll) > fairtoll.zip
echo "Built fairtoll.zip"
