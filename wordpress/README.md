# Fairtoll for WordPress

The Fairtoll plugin shows you which AI bots and agents read your WordPress site, and lets you block them, everywhere or on some paths. It needs only PHP 7.4 or later, so it runs on shared hosting. It takes the same config as the [Fairtoll package](../README.md) for Express and Next.js.

This version observes and blocks. It can't charge yet: a rule that charges is accepted, but AI requests on its paths are let through, and the settings page says so.

## Before you start

- **Bots are recognised by their user-agent only.** A bot that pretends to be a browser is treated as a reader.
- **A page cache can serve a blocked bot a cached page.** If a caching plugin or your host caches pages, the cache can answer a bot without asking WordPress, so the plugin never sees it. Keeping blocking working with a page cache is planned. Until then, exclude the paths you block from the cache, or block AI bots at your host or CDN too.
- **WordPress serves your content at more than one URL.** Fairtoll matches each AI request against your rules by up to three paths, and blocks it if any of them is blocked:
  - by the path it asks for;
  - for a post or page, by the path of its permalink, so `/?page_id=2`, `/?p=1` and a POST to either are covered by the rules for that page or post;
  - for the REST API, by the route's path, such as `/wp-json/wp/v2/pages/2`, also when it comes as `/?rest_route=/wp/v2/pages/2`.

  Write a rule for a post or page as a wildcard, such as `/my-post/*`, so it covers the post's feed and embed too. The REST API and the site's feeds carry the content of many posts at once, so block `/wp-json/*` and `/feed/*` as well. A narrower REST rule, such as `/wp-json/wp/v2/pages/*`, isn't enough, because other routes, such as search and batch requests, return the same content. Archives and the site's feeds, such as categories, search results and `/feed/`, are only matched by the path they're asked for, so `/feed/*` doesn't cover the same feed asked for as `/?feed=rss2`. Rules match pretty permalinks, so on a site with the plain `?p=1` permalinks, only blocking everywhere, with the top-level `"ai": "block"`, covers posts.
- **Rules match the whole path.** If WordPress is installed in a subdirectory, such as `example.com/blog`, include it: `/blog/articles/*`.

## Install

Until the plugin is in the WordPress.org directory, build its zip from this repo, which needs [Composer](https://getcomposer.org/):

```sh
npm run wordpress:zip
```

Then in wp-admin, go to **Plugins > Add New Plugin > Upload Plugin**, choose `fairtoll.zip`, and activate it. Fairtoll starts with an empty config, which only observes, so no page changes.

## Write the config

Go to **Settings > Fairtoll** and paste or edit the config. It's JSON, with the fields described in [The config](../README.md#the-config). For example, to block AI bots on everything under `/articles` and on one page, with its feed and embed:

```json
{
	"rules": [
		{ "path": "/articles/*", "ai": "block" },
		{ "path": "/members-only/*", "ai": "block" }
	]
}
```

A blocked bot gets a 403 with the text `This site does not allow AI bots or agents.` and `Cache-Control: no-store`, before your theme runs. Readers, and every other request, get your site as usual. `/robots.txt` is always served.

If the config has a mistake, the settings page lists each one, and Fairtoll lets every request through until you fix it.

## See your AI traffic

Tick **Log each AI request to the PHP error log** on the settings page. Each request from an AI bot or agent then writes one line of JSON to the PHP error log, in the same format as the package's events:

```json
{"fairtoll":1,"time":"2026-11-17T22:46:48.945Z","path":"/sample-page/","class":"unverifiedBot","reason":"user-agent claims GPTBot","action":"block"}
```

`action` is what the config decided: `allow`, `block`, or `charge`, which this version lets through. Requests from readers aren't logged. Logging is off by default, because a path can carry a secret, such as a password reset token.

Where the PHP error log is depends on your host. Most hosting control panels show it. You can also have WordPress write it to `wp-content/debug.log` by adding these lines to `wp-config.php`:

```php
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', false );
```

Then pick out Fairtoll's lines with `grep '{"fairtoll":1' wp-content/debug.log`.

## When something goes wrong

The plugin fails open. If the config has a mistake, or anything in the plugin throws while it screens a request, the request goes on to WordPress as if Fairtoll weren't installed, and the error is written to the PHP error log. Deactivating the plugin restores your site exactly.

## Working on the plugin

```sh
cd wordpress
composer install
vendor/bin/phpunit
```

The plugin is a port of the package's `classify`, `decide` and `parseConfig`. The cases in [`spec/`](../spec) are run by both PHPUnit and the package's vitest tests, so a change that makes the two disagree fails on both sides. `npm run demo:wordpress` runs a local WordPress with the plugin installed, as [demo/README.md](../demo/README.md#wordpress) describes.

## Publish to WordPress.org

`readme.txt` is the plugin's page in the directory, so keep it in step with this file. CI runs WordPress.org's [Plugin Check](https://wordpress.org/plugins/plugin-check/) on the zip.

To release a version, set it in the `Version` line of `fairtoll.php`, the `Stable tag` in `readme.txt`, and the changelog there, then push a tag such as `wordpress-v0.1.0`. [`wordpress-deploy.yml`](../.github/workflows/wordpress-deploy.yml) checks the three match, builds the zip and commits it to the plugin's SVN. It needs the repo secrets `SVN_USERNAME` and `SVN_PASSWORD`. The directory's banner, icon and screenshots go in `wordpress/.wordpress-org/`, named as [Plugin Assets](https://developer.wordpress.org/plugins/wordpress-org/plugin-assets/) says.

## License

The plugin is licensed under the [GNU General Public License v2 or later](https://www.gnu.org/licenses/gpl-2.0.html). The rest of this repo is Apache-2.0.
