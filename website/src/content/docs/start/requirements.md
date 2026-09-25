---
title: What the server needs
description: The size of server a TomeCMS site needs and why, and the two HTTPS origins and the reverse proxy to set up before installing.
sidebar:
  order: 2
---

One VPS runs the whole site. Docker Compose runs three containers on it: the TomeCMS application, PostgreSQL 17, and SeaweedFS, which stores the media and speaks S3. You put a reverse proxy in front of them for TLS.

## Server size

| | Minimum | Recommended |
| --- | --- | --- |
| CPU | 1 vCPU | 2 vCPU |
| Memory | 2 GB, with 2 GB of swap | 4 GB |
| Disk | 25 GB SSD | 50 GB SSD, more for a large media library |
| Architecture | `amd64` or `arm64` | `amd64` or `arm64` |
| System | 64-bit Linux with systemd, Docker Engine with its Compose plugin, Node.js 22 or later, and Git | Ubuntu 24.04 LTS, which CI runs on |

The deploy helper needs Linux, Node.js and Docker, and a user that can run `docker`. The managed install planned for 1.0.0 also needs systemd 235 or later.

### Why memory

These figures come from measuring the 0.7.0 code on an empty site, not a site under real load. After a few hundred requests the application held about 180 MB, PostgreSQL about 75 MB and SeaweedFS about 90 MB.

The peak is the build. Today's deploy helper builds the application image on the server, and on an upgrade it builds while the site keeps running. `npm run build` alone reached about 700 MB with a warm cache, after `npm ci` had already run, and a first build on a fresh server can take more. That is where a server with 1 GB runs out, and why the minimum is 2 GB with swap.

Uploading an image also takes extra memory for a moment while the server inspects it. That was not measured. Leave room for the operating system and the TLS proxy as well.

### Why disk

The PostgreSQL and SeaweedFS images take about 1.1 GB together, and the application image several hundred MB more. Each build leaves a cache of about the same size, which `docker builder prune` gives back.

Media is stored once, in SeaweedFS. A full backup copies the database and every media object again, so plan for the size of your media times the number of backups you keep on the server, or copy the backups somewhere else. A managed install (1.0.0 and later) takes a backup before each update and never deletes old ones.

## Two HTTPS origins

A site needs two origins, both on HTTPS, with DNS pointing at the server before you install:

- one for the CMS, such as `https://cms.example.com`, where readers and the admin go
- one for the media, such as `https://media.example.com`, the S3 endpoint that serves the files

The media has an origin of its own because the browser sends uploads straight to the bucket, and readers load pictures from it. The deploy helper refuses anything but HTTPS on a public host name for both. A local name such as `localhost`, a private IP address or a name under a test domain is rejected.

## The reverse proxy

The proxy is yours to provide, with its certificates. Point each origin at its port on the server:

| Origin | Forward to |
| --- | --- |
| The CMS, `https://cms.example.com` | `127.0.0.1:4321` |
| The media, `https://media.example.com` | `127.0.0.1:9000` |

Two settings on the proxy matter for uploads. The media origin has to pass the `Host` header through unchanged, because each upload address is signed for that host name. It also has to accept a request body of 25 MB, the largest document the library takes (an image may be up to 8 MB). Some proxies send their own host name upstream or cap a body at 1 MB unless told otherwise; nginx does both.

## Ports and the firewall

Compose binds PostgreSQL (`5432`), SeaweedFS (`9000`) and the application (`4321`) to `127.0.0.1` only. Nothing reaches them from outside except through the proxy, so the firewall needs only SSH, HTTP and HTTPS open.

The install scripts leave the firewall alone and do not obtain certificates. Both are yours to set up.
