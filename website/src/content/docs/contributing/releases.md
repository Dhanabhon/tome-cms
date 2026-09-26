---
title: Releases and changes
description: Where each version's changes and release notes are kept, and what a 0.x version means before 1.0.0.
sidebar:
  order: 6
---

Every version's changes are written down in two places in the repository: a short entry in the changelog, and a longer file of release notes.

## The changelog

[`CHANGELOG.md`](https://github.com/Dhanabhon/tome-cms/blob/main/CHANGELOG.md) lists every release of TomeCMS, newest first, with its date. Its format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). What has changed since the last release waits under "Unreleased".

From 0.8.0 on, an entry is split into what was added, changed and fixed, how to upgrade, and what changed for theme, plugin and headless authors. Earlier entries are a short list. Every entry ends with a link to the version's full notes.

## Release notes

[`docs/releases/`](https://github.com/Dhanabhon/tome-cms/tree/main/docs/releases) holds one file per version, from `0.2.0.md` on. Each file opens with the version's date and its status. From 0.3.0 on, an "Upgrading" section says what the upgrade needs, such as the migrations to run and any new setting or dependency, and later files say what changed for theme, plugin and headless authors. Each of these files ends with a "Validation boundary" section: what was tested for that version, and what is still required before a production tag.

Before you upgrade an install, read the notes of every version after yours. [Updating](/tome-cms/running/updating/) goes through the upgrade itself.

`docs/releases/1.0.0.md` describes the planned 1.0.0 boundary, for a release that has not happened yet: the update path 1.0.0 will support, and what must be true before it is tagged. Its date reads "not scheduled".

## What 0.x means

The changelog's header says that every `0.x` version is a pre-1.0 release candidate, and none is meant for production. Up to 0.12.0, each set of release notes carries the status "Release candidate; not tagged for production". From 0.12.1 on, each version is also tagged and published as a [GitHub release](https://github.com/Dhanabhon/tome-cms/releases), so an install's "System" screen can check for it, and its notes say "Release candidate; tagged and published as a GitHub release, not for production".

For a site you run today, the install is a pre-1.0 preview. A 0.x install is upgraded in place, by running the deploy helper again on a newer checkout, as [Updating](/tome-cms/running/updating/) describes.

The line does not carry over into 1.0.0. A 0.x install cannot become a managed 1.0.0 install in place: that move needs a fresh server, as [Installing on a VPS](/tome-cms/start/install/) explains. 1.0.0 is not released yet. It brings the managed install, whose updater can install a verified update from the admin, starting with 1.0.0 to 1.0.1.

Since 0.11.0, TomeCMS is in a feature freeze: only fixes are merged until 1.0.0. [How to contribute](/tome-cms/contributing/how-to-contribute/) says what that means for a pull request.
