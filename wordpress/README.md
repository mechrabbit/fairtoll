# Fairtoll for WordPress

The Fairtoll plugin shows you which AI bots and agents read your WordPress site, and lets you block them, everywhere or on some paths. It needs only PHP 7.4 or later, so it runs on shared hosting. It takes the same config as the [Fairtoll package](../README.md) for Express and Next.js.

This version observes and blocks. It can't charge yet: a rule that charges is accepted, but AI requests on its paths are let through, and the settings page says so.

## Before you start

- **Bots are recognised by their user-agent only.** A bot that pretends to be a browser is treated as a reader.
- **A page cache can serve a blocked bot a cached page.** If a caching plugin or your host caches pages, the cache can answer a bot without asking WordPress, so the plugin never sees it. Keeping blocking working with a page cache is planned. Until then, exclude the paths you block from the cache, or block AI bots at your host or CDN too.
- **Rules match the URL path, and WordPress serves your content at more than one URL.** A post's own feed and embed are under its path (`/my-post/feed/`, `/my-post/embed/`), so write a rule for a post or page as a wildcard, such as `/my-post/*`, which covers them, and a section as `/articles/*`. The REST API (`/wp-json/...`) and feeds (`/feed/`) carry post content too, so block `/wp-json/*` and `/feed/*` as well. Some URLs pick the content in the query string, which rules don't match: the REST API also answers at `/?rest_route=/...`, and a POST to `/?page_id=2` serves that page. Only blocking everywhere, with the top-level `"ai": "block"`, covers those.
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

A blocked bot gets a 403 with the text `This site does not allow AI bots or agents.` and `Cache-Control: no-store`, before your theme or any page code runs. Readers, and every other request, get your site as usual. `/robots.txt` is always served.

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
