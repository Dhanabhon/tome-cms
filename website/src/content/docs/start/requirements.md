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
| System | 64-bit Linux with systemd, Docker Engine with its Compose plugin, Node.js 22.12 or newer, and Git | Ubuntu 24.04 LTS, which CI runs on |

The managed installer runs as root and also needs systemd 235 or later. A build from source with the deploy helper needs Linux, Node.js and Docker, and a user that can run `docker`.

### Why memory

These figures come from measuring the 0.7.0 code on an empty site, not a site under real load. After a few hundred requests the application held about 180 MB, PostgreSQL about 75 MB and SeaweedFS about 90 MB.

The peak is the build. A managed install pulls a built image and builds only the small updater, but a build from source builds the application image on the server, and on an upgrade it builds while the site keeps running. `npm run build` alone reached about 700 MB with a warm cache, after `npm ci` had already run, and a first build on a fresh server can take more. That is where a server with 1 GB runs out, and why the minimum is 2 GB with swap.

Uploading an image also takes extra memory for a moment while the server inspects it. That was not measured. Leave room for the operating system and the TLS proxy as well.

A managed install is lighter, because it never builds the application. The test server behind these pages has 1 GB of memory, one shared vCPU and 2 GB of swap, and has run a managed install with real content since 1.0.1, through every update since. With the site in use it had about 400 MB available and swap in use, so the swap is what makes 1 GB work. Measured on it with 1.3.0, the home page answered about 17 requests a second with no failures, four at a time: comfortably a few hundred readers at once, a site of tens of thousands of page views a day. That is enough for a personal site. Take 2 GB for anything busier, or for a build from source.

### Why disk

The PostgreSQL and SeaweedFS images take about 1.1 GB together, and the application image several hundred MB more. Each build leaves a cache of about the same size, which `docker builder prune` gives back.

Media is stored once, in SeaweedFS. From 1.20.0 each image also has up to three smaller WebP copies, 480, 960 and 1600 pixels wide, that pages load in its place. Together they usually take less than the original, so allow a little more room for images than the files you upload. A full backup copies the database and every media object again, so plan for the size of your media times the number of backups you keep on the server, or copy the backups somewhere else. A managed install (1.0.0 and later) takes a backup before each update and never deletes old ones.

## Where to get a server

TomeCMS runs on any VPS that meets the sizes above. If you don't have one yet, these referral links support the project at no extra cost to you:

- **DigitalOcean**: new accounts get free credit to start with. <a href="https://m.do.co/c/724516110262" rel="sponsored noopener">Sign up through this link</a>.
- **Vultr**: new accounts get $300 of credit to try the platform, usable for 30 days (a valid card or PayPal is required). <a href="https://www.vultr.com/?ref=9926955-9J" rel="sponsored noopener">Sign up through this link</a>.

These are referral links: when an account made through them pays for a server, the project receives credit from the provider. Any VPS works the same.

## Two HTTPS origins

A site needs two origins, both on HTTPS, with DNS pointing at the server before you install:

- one for the CMS, such as `https://cms.example.com`, where readers and the admin go
- one for the media, such as `https://media.example.com`, the S3 endpoint that serves the files

The media has an origin of its own because the browser sends uploads straight to the bucket, and readers load images from it. The deploy helper refuses anything but HTTPS on a public host name for both. A local name such as `localhost`, a private IP address or a name under a test domain is rejected.

Set up DNS first, because a new record can take a while to reach everyone. The scripts do not wait for it: they check only the form of each address, and Caddy from `prepare-vps.sh` keeps asking for certificates until the names point at the server. The first-run wizard at `/install` opens once they do.

### Pointing DNS at the server

At the company that runs DNS for your domain, usually the registrar where you bought it, add a record for each name. The value is the public IPv4 address from your VPS provider.

| Type | Name | Value |
| --- | --- | --- |
| `A` | `cms` | `203.0.113.10`, your server's address |
| `A` | `media` | the same address |

- **Name.** Most providers want only the part before your domain, `cms`. Some want the whole name, `cms.example.com`. The CMS may also sit on the domain itself, with the name `@`, but the media always needs a name of its own.
- **IPv6.** Add an `AAAA` record only when the server has a working IPv6 address with ports 80 and 443 open on it. Let's Encrypt tries IPv6 first, so an `AAAA` record that leads nowhere can stop the certificate.
- **Old records.** Delete any other `A`, `AAAA` or `CNAME` record for the same names, such as a registrar's parking page. A name that answers with two servers gets its certificate only some of the time.
- **Cloudflare and other proxying DNS.** Set both records to DNS only (the grey cloud on Cloudflare), so that Caddy talks to Let's Encrypt directly. These docs cover only that setup.
- **TTL.** The provider's default is fine. A new name answers within minutes. A name that already pointed somewhere else can keep the old answer for as long as its old TTL.

To check, run this on your own computer, `nslookup` on Windows:

```sh
dig +short cms.example.com
dig +short media.example.com
```

Each should print only your server's address. `prepare-vps.sh` also prints what both names point at in its DNS step, but it cannot tell whether that is the right server: on some providers, such as AWS, the public address is not on any of the server's interfaces.

### Without a domain yet

The CMS origin has to be a host name, not an IP address. The owner signs in with a passkey, the passkey belongs to the CMS host name, and browsers refuse to create one for an IP address. A public IP gets past the deploy helper's check, and the first-run wizard then cannot save the owner's passkey.

- **Register a domain.** One domain covers both origins, as two names under it such as `cms.` and `media.`. This is the setup to keep.
- **For a trial, use a name that carries the server's address.** A service such as [sslip.io](https://sslip.io) answers a name with the address written into it, so it needs no DNS setup, and Caddy gets certificates for it like any other name. For a server at `203.0.113.10`:

  ```sh
  export TOME_CMS_PUBLIC_URL=https://cms.203-0-113-10.sslip.io
  export S3_ENDPOINT=https://media.203-0-113-10.sslip.io
  ```

- **To look around first,** run TomeCMS on your own computer with `npm run dev:macos`, which needs neither a domain nor HTTPS.

Moving a trial site to your own domain later works, with one catch: the owner's passkey stays with the old name and does not sign in on the new one. Point the new names at the server, run `prepare-vps.sh` and then `./scripts/deploy-vps.sh --force` with the new addresses, and sign in with [a recovery code](/tome-cms/running/recovery/#with-a-recovery-code), which creates a passkey for the new name. Keep a code at hand before you switch. Media addresses are worked out each time a page is served, so images follow the new media origin by themselves.

The CMS origin answers with `Strict-Transport-Security: max-age=31536000`. A browser that has opened the site once over HTTPS then goes straight to HTTPS for a year, even for an address typed as `http://`, so a network in between cannot keep it on plain HTTP. The header has no `includeSubDomains` and no `preload`, so it says nothing about your other host names, and the media origin does not send it. A proxy in front, such as Cloudflare, may add its own HSTS; that does no harm.

## The reverse proxy

The proxy is yours to provide, with its certificates, unless [`prepare-vps.sh`](/tome-cms/start/prepare-server/) sets up Caddy for you. Point each origin at its port on the server:

| Origin | Forward to |
| --- | --- |
| The CMS, `https://cms.example.com` | `127.0.0.1:4321` |
| The media, `https://media.example.com` | `127.0.0.1:9000` |

Two settings on the proxy matter for uploads. The media origin has to pass the `Host` header through unchanged, because each upload address is signed for that host name. It also has to accept a request body of 25 MB, the largest document the File Manager takes (an image may be up to 8 MB). The CMS origin takes uploads too: a logo or icon is sent to it, and a share image of up to 8 MB, so it needs a body limit of at least 8 MB. Some proxies send their own host name upstream or cap a body at 1 MB unless told otherwise; nginx does both.

The proxy also has to tell the application who is connecting, by setting or adding the address it saw in the `X-Forwarded-For` header. Caddy does, and nginx needs `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. The application reads the last entry, the one the proxy wrote, and only when the connection comes from the proxy's side: a loopback address, or one in `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` or `fc00::/7`. The limits on signing in, recovery, installing and updating read it from 1.1.2, the limit on searching the posts from 1.2.0, and the reader counts in "Stats" always have.

Two ways of getting this wrong are worth knowing. A proxy that leaves the header out makes every visitor count as the proxy, so ten failed sign-ins, or sixty searches, from anyone use up everyone's allowance. A proxy that passes a visitor's own header through untouched, which nginx does without the line above, lets that visitor choose the address the limits count. Behind a CDN the proxy sees the CDN's address unless it is set up to trust the CDN's header, and the limits then count the CDN's address.

On the media origin, a proxy of your own should do three more things, as the Caddy that `prepare-vps.sh` writes does from 1.16.4. Drop the `response-*` query parameters (`response-content-type`, `response-content-disposition` and the rest) from every request: the storage honours them for anyone, so a link could otherwise hand an image over as a web page. Send `X-Content-Type-Options: nosniff` with every file. And send `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` with every `.svg`, so a logo or icon opened at its own address runs nothing. TomeCMS's own uploads never use those parameters.

## Ports and the firewall

Compose binds PostgreSQL (`5432`), SeaweedFS (`9000`) and the application (`4321`) to `127.0.0.1` only. Nothing reaches them from outside except through the proxy, so the firewall needs only SSH, HTTP and HTTPS open.

The install scripts leave the firewall alone and do not obtain certificates. [`prepare-vps.sh`](/tome-cms/start/prepare-server/) does both: it opens only SSH, 80 and 443 in `ufw`, and Caddy gets the certificates. Without it, both are yours to set up.
