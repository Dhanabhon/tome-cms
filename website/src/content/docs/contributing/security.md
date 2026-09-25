---
title: Security policy
description: How to report a vulnerability in TomeCMS privately, which versions get fixes, and what is in scope.
sidebar:
  order: 5
---

This page follows [`SECURITY.md`](https://github.com/Dhanabhon/tome-cms/blob/main/SECURITY.md) in the repository.

## Reporting a vulnerability

Please report a vulnerability privately, not in an issue, a discussion or a pull request. Use GitHub's private vulnerability reporting: open the repository's "Security" tab and choose "Report a vulnerability", or go straight to [the private report form](https://github.com/Dhanabhon/tome-cms/security/advisories/new). Only the maintainer can read the report.

A useful report says:

- which version or commit you tested
- how TomeCMS was installed (on a VPS with the deploy helper, a local development setup, or something else), and whether it runs in bundled or headless mode
- what an attacker can do, and what they need first (an account, a network position, a crafted file)
- the smallest steps that reproduce it

Please do not test against a site you do not run, and do not read, change or delete other people's data to prove a point.

TomeCMS is maintained by one person. Expect a first answer within seven days and an assessment within thirty. You will hear when a fix is ready and when it is released. Unless you ask not to be, you will be credited in the release notes.

## Supported versions

| Version | Fixes |
| --- | --- |
| The latest `0.x` release and `main` | Yes, until 1.0.0 is released |
| Earlier `0.x` releases | No. Upgrade to the latest, as [Updating](/tome-cms/running/updating/) describes. |

After 1.0.0, the latest `1.x` release is supported, and the managed updater carries the fix. 1.0.0 is not released yet.

## Scope

In scope is everything in this repository:

- the admin, the public site and the content API
- sign-in, recovery and the installer
- the managed updater and its host service
- the release workflow, the release manifest and its attestations
- the Docker image

Out of scope:

- A vulnerability in a dependency that is already public. Report it upstream. Do tell us if TomeCMS is exposed to it in a way its advisory does not cover.
- Findings that need the owner to misconfigure the server first, such as publishing PostgreSQL or SeaweedFS on a public address.
- Denial of service by sheer volume.
- Adding to the Stats counts within the [documented per-address limit](/tome-cms/api/counting-readers/). They are published as estimates.
