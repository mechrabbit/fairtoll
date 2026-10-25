# AGENTS.md

The [README](README.md) sets what the package must do and how to decide what belongs in it. This file covers how to work on it.

## Code is a liability

Fairtoll runs in a publisher's request path and handles payments. A bug here breaks someone's site or costs someone money, and complexity is where bugs hide. Treat every line you add, and every runtime dependency you pull in, as a cost the package carries from then on. The goal is code that is correct and stays maintainable. Fewer lines is a means to that, not the target.

Default to not building. New code earns its place by meeting a concrete need that exists now, not one you anticipate. When you're unsure whether something is needed, leave it out and say so in a sentence, so a person can ask for it.

A runtime dependency is code you ship but don't read. That trade is worth it when the dependency implements something the package must not get wrong on its own, such as payments through the official `@x402` packages or protocol and cryptographic verification. For anything that is only a convenience, code you own and can read is usually the smaller risk.

Before you call work done, reread it as a reviewer would. Ask whether someone could confirm it is correct, including what happens when it fails, in a single read. If not, simplify it until they can.
