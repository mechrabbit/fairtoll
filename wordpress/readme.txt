=== Fairtoll ===
Contributors: mechrabbit
Tags: ai, bots, crawlers, block bots, ai crawlers
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

See which AI bots and agents read your site, and block them everywhere or on the paths you choose. It only observes until you change its config.

== Description ==

Fairtoll recognises AI bots and agents, such as GPTBot, ClaudeBot and PerplexityBot, by their user-agent. You decide, path by path, whether they are allowed or blocked. Readers always get your site as usual.

* **Observes by default.** With an empty config, nothing changes. Turn on logging to see which AI bots visit and what they read.
* **Blocks before your theme runs.** A blocked bot gets a 403 with `Cache-Control: no-store`, so a cache won't show the block to readers.
* **Covers WordPress's other URLs for a page.** A bot can't get around a rule for a page by asking for it as `/?page_id=2`, or through the REST API as `/?rest_route=/wp/v2/pages/2`.
* **Fails open.** If the config has a mistake, or anything goes wrong while a request is screened, the request goes on to WordPress as if Fairtoll weren't installed.
* **Same config as the Fairtoll package.** The JSON config is the one the Fairtoll package takes for Express and Next.js, so one config works on every site you run.

This version observes and blocks. A rule that charges AI bots is accepted, but those requests are let through and logged as "charge", and the settings page says so.

= Limits =

* Bots are recognised by their user-agent only. A bot that pretends to be a browser is treated as a reader.
* A page cache can answer a bot without asking WordPress, so Fairtoll never sees the request. Exclude the paths you block from your cache, or block AI bots at your host or CDN too.
* Rules match pretty permalinks. Archives and site feeds asked for by query string, such as `/?feed=rss2`, are matched only by the path asked for.

The full guide, with every case, is at https://github.com/mechrabbit/fairtoll/tree/main/wordpress#readme.

= External services =

Fairtoll doesn't connect to any external service. It makes no network requests, and nothing about your site or its visitors leaves your server.

= Privacy =

Fairtoll stores two options in your database: the config, and whether logging is on. When logging is on, each request from an AI bot or agent writes one line to your PHP error log, with the time, the path asked for, how Fairtoll classed the request and what it did. Requests from readers are never logged. Logging is off by default, because a path can carry a secret, such as a password reset link.

= Source code =

The plugin's source, its tests and the build script for this zip are at https://github.com/mechrabbit/fairtoll, in the `wordpress` folder.

== Installation ==

1. In wp-admin, go to Plugins > Add New Plugin, search for "Fairtoll", and install and activate it.
2. Go to Settings > Fairtoll. The config starts empty, which only observes.
3. To see your AI traffic, tick "Log each AI request to the PHP error log" and save.
4. To block AI bots, paste a config, such as the one below, and save.

`{ "rules": [{ "path": "/articles/*", "ai": "block" }] }`

To block AI bots everywhere, use `{ "ai": "block" }`.

== Frequently Asked Questions ==

= Which paths should I block? =

Write a rule for a post or page as a wildcard, such as `/my-post/*`, so it covers the post's feed and embed too. The REST API and the site's feeds carry the content of many posts at once, so block `/wp-json/*` and `/feed/*` as well. If WordPress is installed in a subdirectory, such as `example.com/blog`, include it: `/blog/articles/*`.

= Where do I find the log? =

In the PHP error log, which most hosting control panels show. You can also have WordPress write it to `wp-content/debug.log` by adding `define( 'WP_DEBUG_LOG', true );` and `define( 'WP_DEBUG_DISPLAY', false );` to `wp-config.php`. Each of Fairtoll's lines starts with `{"fairtoll":1`.

= What happens if my config has a mistake? =

The settings page lists each mistake, and Fairtoll lets every request through until you fix it.

= Is robots.txt still served? =

Yes. `/robots.txt` is always served, to bots too.

= How do I remove it? =

Deactivating the plugin restores your site exactly. Deleting it also removes its two options.

== Changelog ==

= 0.1.0 =
* First release: observes and blocks AI bots and agents by path.

== Upgrade Notice ==

= 0.1.0 =
First release.
