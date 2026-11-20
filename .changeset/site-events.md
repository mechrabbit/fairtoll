---
"fairtoll": minor
---

`site: { key, events: true }` sends fairtoll.net each event that `log` would get, so the dashboard can show a site's AI traffic and what it paid. Events now name the `bot`, and a charged request's event has its `price`, `network` and `payment`: `paid`, `none`, `rejected` or `failed`. Events are passed to `log` once the request's outcome is known, so after a charged request settles. `screen` no longer logs: it returns the action and the request's classification.
