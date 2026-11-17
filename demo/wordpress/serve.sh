#!/bin/sh
# A local WordPress with the plugin in wordpress/ installed, on PHP's built-in server and SQLite, so it needs only
# PHP and Composer. The first run downloads WordPress into demo/wordpress/site and installs it, with the plugin
# active, logging on, and the config in demo/wordpress/config.json. Run from the repo root:
#   npm run demo:wordpress
set -e
wordpress_version=7.1.4
sqlite_version=3.1.3
port="${PORT:-8080}"
site=demo/wordpress/site

composer install --working-dir=wordpress --no-interaction --quiet
if [ ! -f "$site/wp-config.php" ]; then
	rm -rf "$site" demo/wordpress/downloads
	mkdir -p demo/wordpress/downloads
	curl -fsSL -o demo/wordpress/downloads/wordpress.zip "https://wordpress.org/wordpress-$wordpress_version.zip"
	curl -fsSL -o demo/wordpress/downloads/sqlite.zip "https://downloads.wordpress.org/plugin/sqlite-database-integration.$sqlite_version.zip"
	unzip -q demo/wordpress/downloads/wordpress.zip -d demo/wordpress/downloads
	mv demo/wordpress/downloads/wordpress "$site"
	unzip -q demo/wordpress/downloads/sqlite.zip -d "$site/wp-content/plugins"
	rm -rf demo/wordpress/downloads
	# The SQLite plugin's database drop-in, pointed at the plugin.
	sed -e "s#{SQLITE_IMPLEMENTATION_FOLDER_PATH}#$PWD/$site/wp-content/plugins/sqlite-database-integration#" \
		-e "s#{SQLITE_PLUGIN}#sqlite-database-integration/load.php#" \
		"$site/wp-content/plugins/sqlite-database-integration/db.copy" > "$site/wp-content/db.php"
	ln -s "$PWD/wordpress" "$site/wp-content/plugins/fairtoll"
	cp demo/wordpress/wp-config.php "$site/wp-config.php"
	php demo/wordpress/install.php "$site" "http://localhost:$port"
fi
echo "WordPress is at http://localhost:$port, and wp-admin's user and password are both demo."
# PHP's built-in server sends a path that isn't a file to index.php, as a host's rewrite rules do, and prints
# what the plugin writes to the PHP error log.
exec php -S "localhost:$port" -t "$site"
