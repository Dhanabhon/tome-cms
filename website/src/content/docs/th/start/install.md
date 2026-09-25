---
title: ติดตั้งบน VPS
description: ติดตั้ง TomeCMS รุ่นพรีวิวก่อน 1.0 บนเซิร์ฟเวอร์ Linux เครื่องเดียวด้วยสคริปต์ deploy และสิ่งที่การติดตั้งแบบ managed จะเปลี่ยนไปใน 1.0.0
sidebar:
  order: 3
---

การติดตั้งในตอนนี้เป็นรุ่นพรีวิวก่อน 1.0 สคริปต์ deploy (`scripts/deploy-vps.sh`) จะรัน PostgreSQL, SeaweedFS และแอปด้วย Docker Compose แล้ว build image ของแอปบนเซิร์ฟเวอร์จากโค้ดที่คุณ clone มา

ก่อนเริ่ม ให้เตรียมเซิร์ฟเวอร์ให้พร้อม ชี้ DNS ของทั้งสอง origin มาที่เครื่อง และตั้ง reverse proxy ไว้ตามหน้า[สิ่งที่เซิร์ฟเวอร์ต้องมี](/tome-cms/th/start/requirements/) สคริปต์ทำงานบน Linux และต้องมี Node.js 22 ขึ้นไป, Docker Engine พร้อมปลั๊กอิน Compose และ Git ให้รันด้วยผู้ใช้ที่สั่ง `docker` ได้

## 1. ดึงโค้ดลงเครื่อง

บนเซิร์ฟเวอร์ ให้ clone repository แล้วเข้าไปในโฟลเดอร์

```sh
git clone https://github.com/Dhanabhon/tome-cms.git
cd tome-cms
```

## 2. กำหนดที่อยู่ทั้งสาม

```sh
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
```

`TOME_CMS_PUBLIC_URL` คือ origin ของ CMS ห้ามมี path ต่อท้าย `S3_ENDPOINT` คือ origin ของมีเดีย ส่วน `MEDIA_PUBLIC_URL` คือที่ที่ผู้อ่านโหลดไฟล์ ซึ่งก็คือ origin ของมีเดียตามด้วยชื่อ bucket `tomecms-media` ถ้าไม่กำหนดค่านี้ สคริปต์จะประกอบที่อยู่แบบเดียวกันให้จาก `S3_ENDPOINT` กับชื่อ bucket

## 3. รันสคริปต์ deploy

```sh
./scripts/deploy-vps.sh
```

สคริปต์ทำงานตามลำดับนี้ และหยุดทันทีที่ขั้นไหนไม่ผ่าน

1. ตรวจว่าเครื่องเป็น Linux มีคำสั่ง `node` และ `docker`, Docker ทำงานอยู่ และ Node.js เป็นเวอร์ชัน 22 ขึ้นไป
2. สร้างค่าลับ ได้แก่ รหัสผ่านฐานข้อมูล, secret key ของ S3, installation token และค่าลับอีกสามค่าที่แอปใช้เซ็นและ hash ข้อมูล แล้วตรวจว่าที่อยู่ทั้งสามเป็น HTTPS บนชื่อโฮสต์สาธารณะ
3. ตรวจว่าพอร์ต `5432`, `9000` และ `4321` บน `127.0.0.1` ยังว่างอยู่
4. เขียนไฟล์ `.env.local` ไว้ในโฟลเดอร์โค้ด โดยให้เจ้าของไฟล์อ่านได้คนเดียว
5. ดึง image ที่ปักเวอร์ชันไว้ คือ `postgres:17-alpine` กับ `chrislusf/seaweedfs:4.46` แล้วเปิดใช้งานและรอจนทั้งสองพร้อม
6. build image ของแอป
7. รัน migration ของฐานข้อมูลในคอนเทนเนอร์แอปที่ใช้ครั้งเดียวแล้วทิ้ง
8. เปิดแอปและรอจน `/health/ready` รายงานว่าพร้อม
9. พิมพ์ที่อยู่ของตัวช่วยตั้งค่าครั้งแรกและ installation token ออกมา

ท้ายผลลัพธ์จะหน้าตาแบบนี้

```text
Starting PostgreSQL and SeaweedFS…
Applying database migrations…
Installer: https://cms.example.com/install
Installation token: <the token>
```

token ยังเก็บอยู่ใน `.env.local` เปิดดูอีกครั้งภายหลังได้ด้วยคำสั่งนี้

```sh
grep '^TOME_CMS_INSTALL_TOKEN=' .env.local
```

ในไฟล์นี้ทุกค่าอยู่ในเครื่องหมายคำพูดเดี่ยว ตอนคัดลอก token ไม่ต้องเอาเครื่องหมายมาด้วย

## 4. ตรวจว่าเว็บตอบแล้ว

ถามแอปว่าพร้อมหรือยัง ครั้งแรกถามจากบนเซิร์ฟเวอร์เอง ครั้งที่สองถามผ่าน proxy

```sh
curl -s http://127.0.0.1:4321/health/ready
curl -s https://cms.example.com/health/ready
```

ทั้งสองคำสั่งควรได้ผลแบบนี้

```json
{"status":"ready","checks":{"database":"ready","migrations":"ready","storage":"ready"}}
```

ถ้าคำสั่งแรกตอบแต่คำสั่งที่สองไม่ตอบ ให้ตรวจ DNS และ proxy ถ้าคำสั่งแรกแสดง `"storage":"unavailable"` แปลว่า DNS หรือ proxy ของ origin มีเดียยังไม่ตอบ เพราะแอปเข้าถึง bucket ผ่าน `S3_ENDPOINT` เมื่อตอบทั้งคู่แล้ว เปิด `https://cms.example.com/install` แล้วไปต่อที่[ตัวช่วยตั้งค่าครั้งแรก](/tome-cms/th/start/first-run/)

## ถ้าสคริปต์หยุดกลางทาง

สคริปต์จะพิมพ์ข้อความหนึ่งบรรทัดบอกว่าติดตรงไหน ข้อความที่เจอบ่อยมีดังนี้

| ข้อความ | สิ่งที่ต้องทำ |
| --- | --- |
| `Error: VPS deployment requires Linux. Use npm run dev:macos for local macOS development.` | รันบนเซิร์ฟเวอร์ Linux |
| `Error: Docker is not running or the current user cannot access it.` | เปิด Docker หรือเพิ่มผู้ใช้ของคุณเข้ากลุ่ม `docker` แล้วล็อกอินใหม่ |
| `Port 4321 is unavailable.` (หรือ `5432`, `9000`) | มีโปรแกรมอื่นใช้พอร์ตนั้นบน `127.0.0.1` อยู่ ให้หยุดโปรแกรมนั้น หรือ export `APP_PORT`, `POSTGRES_PORT` หรือ `S3_PORT` เป็นพอร์ตที่ว่าง ถ้าเปลี่ยน `APP_PORT` หรือ `S3_PORT` ให้ชี้ proxy ไปที่พอร์ตใหม่ด้วย และถ้าเปลี่ยนพอร์ตหลังรันครั้งแรกไปแล้ว ต้องใช้ `--force` |
| `TOME_CMS_PUBLIC_URL requires HTTPS without credentials; configure TLS separately.` | ใช้ที่อยู่ `https://` ที่ไม่มีชื่อผู้ใช้หรือรหัสผ่านอยู่ข้างใน กติกาเดียวกันนี้ใช้กับ `S3_ENDPOINT` และ `MEDIA_PUBLIC_URL` ด้วย |
| `TOME_CMS_PUBLIC_URL requires a browser-reachable public host; local or special-use address forms are not allowed.` | ใช้ชื่อโฮสต์สาธารณะที่ DNS ชี้มาที่เซิร์ฟเวอร์ ไม่ใช่ IP หรือชื่อในเครื่อง |
| `Set .env.local permissions to 0600 before continuing.` | รัน `chmod 600 .env.local` |
| `Existing .env.local needs updates; rerun with --force to merge values while preserving secrets.` | มีค่าที่ไม่ตรงกับใน `.env.local` ส่วนใหญ่คือที่อยู่หรือพอร์ตที่คุณเปลี่ยน ให้รัน `./scripts/deploy-vps.sh --force` เพื่อเขียนค่าใหม่โดยเก็บค่าลับเดิมไว้ |
| `docker compose failed; inspect the service privately.` | ขั้นตอนหนึ่งของ Compose ล้มเหลว ผลลัพธ์ของขั้นนั้นอาจมีค่าลับปนอยู่ สคริปต์จึงไม่พิมพ์ออกมา ให้อ่าน log เองด้วย `docker compose -f compose.yaml --env-file .env.local --profile production logs --tail 100` |

## รันซ้ำเพื่ออัปเกรด

ตอนนี้ ถ้าจะอัปเกรดเว็บที่ติดตั้งเป็น 0.x ให้รันสคริปต์อีกครั้งจากโค้ดที่ใหม่กว่า ก่อนรันให้สำรอง PostgreSQL และ bucket ของมีเดียไว้พร้อมกัน แล้วจึงสั่ง

```sh
git pull
./scripts/deploy-vps.sh
```

สคริปต์จะใช้ `.env.local` เดิมตามที่เป็นอยู่ build image ใหม่ของแอประหว่างที่ตัวเก่ายังให้บริการเว็บอยู่ รัน migration ใหม่ แล้วจึงสลับคอนเทนเนอร์แอปเป็นตัวใหม่

## สิ่งที่จะเปลี่ยนใน 1.0.0

:::caution[ยังไม่เปิดให้ใช้]
การติดตั้งแบบ managed ยังใช้ไม่ได้ ต้องรอให้ repository ทางการและ image บน GHCR เปิดเป็นสาธารณะ และมี release `v1.0.0` แบบ stable ที่เผยแพร่แล้วและแก้ไขไม่ได้ พร้อมไฟล์ `update-manifest.json`, `update-manifest.attestation.json` และ `tomecms-image.attestation.json` มีแค่ tag อย่างเดียวยังไม่พอ
:::

ตั้งแต่ 1.0.0 VPS เครื่องใหม่จะติดตั้งแบบ managed ซึ่งต่างจากการติดตั้งตอนนี้ดังนี้

- image ของแอปดึงมาจาก GHCR ด้วย digest และตรวจกับ attestation ของ release ก่อนใช้ เซิร์ฟเวอร์ build เองเฉพาะ service ตัว updater จากโค้ดชุดเดียวกัน
- ค่าลับย้ายไปอยู่ใน `/etc/tome-cms/tome-cms.env` แทน `.env.local` และอ่าน token ได้ด้วย `sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env`
- มี service ของ systemd แยกอีกตัวชื่อ `tomecms-updater` ที่ทำให้เจ้าของติดตั้งอัปเดตที่ตรวจสอบแล้วได้จากหน้าแอดมิน เริ่มจาก 1.0.0 ไป 1.0.1 และสำรองข้อมูลเต็มชุดก่อนอัปเดตทุกครั้ง
- ตัวติดตั้งต้องรันด้วยสิทธิ์ root และนอกจากสิ่งที่ต้องมีในตอนนี้ ยังต้องมี systemd 235 ขึ้นไป, Node.js ที่ `/usr/bin/node`, npm, curl และ GitHub CLI ที่ `gh attestation verify` รองรับ `--bundle`, `--signer-workflow`, `--source-ref`, `--source-digest` และ `--deny-self-hosted-runners`
- พอร์ตของแอปถูกกำหนดตายตัวไว้ที่ `4321`

คำสั่งที่จะใช้เมื่อมี `v1.0.0` แล้ว

```sh
git checkout --detach v1.0.0
npm ci
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
./scripts/install-managed-vps.sh --dry-run --version 1.0.0
sudo --preserve-env=TOME_CMS_PUBLIC_URL,S3_ENDPOINT,MEDIA_PUBLIC_URL \
  ./scripts/install-managed-vps.sh --version 1.0.0
```

dry run จะตรวจ release, attestation, โค้ดที่ checkout ไว้ และตัวเซิร์ฟเวอร์ แล้วพิมพ์แผนออกมาเป็น JSON โดยไม่เปลี่ยนแปลงอะไรเลย ถ้า checkout ไว้ที่ tag แบบ stable ตั้งแต่ `v1.0.0` ขึ้นไป `./scripts/deploy-vps.sh` จะส่งต่อให้ตัวติดตั้งแบบ managed เอง

การติดตั้ง 0.x เปลี่ยนเป็นแบบ managed บนเครื่องเดิมไม่ได้ ไม่ว่าจะผ่านหน้าแอดมินหรือรันตัวติดตั้งทับ ให้สำรองข้อมูลเต็มชุดและตรวจว่ากู้คืนได้จริง เก็บค่าลับเดิมไว้ในที่ปลอดภัย แล้วเตรียมเซิร์ฟเวอร์ใหม่แยกต่างหากสำหรับ 1.0.0 ย้ายเนื้อหาไปเองแล้วตรวจบนเครื่องใหม่ สลับ DNS ก็ต่อเมื่อ HTTPS, Passkey, เนื้อหา และมีเดียบนเครื่องใหม่ใช้ได้ครบแล้ว และเก็บเครื่องเก่ากับชุดสำรองไว้จนกว่าจะมั่นใจ
