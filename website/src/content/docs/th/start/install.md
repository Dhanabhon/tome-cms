---
title: ติดตั้งบน VPS
description: ติดตั้ง TomeCMS บนเซิร์ฟเวอร์ Linux เครื่องเดียวด้วยตัวติดตั้งแบบ managed ซึ่งรัน release ที่ตรวจสอบแล้วและให้หน้าแอดมินติดตั้งอัปเดตได้ และวิธี build จากซอร์สโค้ดแทน
sidebar:
  order: 3
---

ตั้งแต่ 1.0.0 เป็นต้นไป VPS จะติดตั้งแบบ managed ตัวติดตั้ง `scripts/install-managed-vps.sh` ดึง image ของแอปใน release นั้นมาจาก GHCR ด้วย digest และตรวจกับ attestation ของ release แล้วรัน PostgreSQL, SeaweedFS และแอปด้วย Docker Compose และตั้ง service ของ systemd ชื่อ `tomecms-updater` ไว้ ซึ่งทำให้เจ้าของเว็บติดตั้งอัปเดตที่ตรวจสอบแล้วได้จากเมนู "ระบบ" ในหน้าแอดมิน

ก่อนเริ่ม ให้เตรียมเซิร์ฟเวอร์ให้พร้อม ชี้ DNS ของทั้งสอง origin มาที่เครื่อง และตั้ง reverse proxy ไว้ตามหน้า[สิ่งที่เซิร์ฟเวอร์ต้องมี](/tome-cms/th/start/requirements/) ตัวติดตั้งรันด้วยสิทธิ์ root บน Linux และต้องมี Docker Engine พร้อมปลั๊กอิน Compose, Git, systemd 235 ขึ้นไป, Node.js 22 ที่ `/usr/bin/node` พร้อม npm, curl และ GitHub CLI ที่ `gh attestation verify` รองรับ `--bundle`, `--signer-workflow`, `--source-ref`, `--source-digest` และ `--deny-self-hosted-runners`

ถ้าเป็นเซิร์ฟเวอร์ Ubuntu 24.04 ที่เพิ่งสร้าง หน้า[เตรียมเซิร์ฟเวอร์ใหม่](/tome-cms/th/start/prepare-server/) ตั้งทุกอย่างนี้ได้ด้วยสคริปต์เดียว และติดตั้ง TomeCMS ให้ด้วยก็ได้

## 1. ดึง release ลงเครื่อง

ในฐานะ root ให้ติดตั้ง package ของ release ในโฟลเดอร์ที่หน้า[เตรียมเซิร์ฟเวอร์ใหม่](/tome-cms/th/start/prepare-server/) clone ไว้

```sh
cd /opt/tome-cms-src
npm ci
```

ถ้าเตรียมเซิร์ฟเวอร์ด้วยวิธีอื่น ให้ clone tag ของ release ไว้ที่นั่นก่อน

```sh
git clone --depth 1 --branch v1.0.3 https://github.com/Dhanabhon/tome-cms.git /opt/tome-cms-src
```

ใช้เวอร์ชันล่าสุดจาก[หน้า Releases](https://github.com/Dhanabhon/tome-cms/releases) ทั้งที่นี่และในคำสั่งด้านล่าง ตัวติดตั้งทำงานได้เฉพาะจากโค้ดที่ checkout ไว้ตรง tag นั้นพอดีและไม่มีอะไรถูกแก้ และ build ตัวอัปเดตด้วย package ที่ `npm ci` ติดตั้งไว้ อย่าลบโฟลเดอร์นี้ทิ้ง เพราะการตรวจการกู้คืนในหน้า[สำรองและกู้คืนข้อมูล](/tome-cms/th/running/backups/) รันจากโค้ดที่ checkout ไว้ที่ release เดียวกัน

## 2. กำหนดที่อยู่ทั้งสาม

```sh
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
```

`TOME_CMS_PUBLIC_URL` คือ origin ของ CMS ห้ามมี path ต่อท้าย `S3_ENDPOINT` คือ origin ของมีเดีย ส่วน `MEDIA_PUBLIC_URL` คือที่ที่ผู้อ่านโหลดไฟล์ ซึ่งก็คือ origin ของมีเดียตามด้วยชื่อ bucket `tomecms-media` ถ้าไม่กำหนดค่านี้ ตัวติดตั้งจะประกอบที่อยู่แบบเดียวกันให้จาก `S3_ENDPOINT` กับชื่อ bucket

## 3. รันตัวติดตั้ง

ลองด้วย `--dry-run` ก่อน แล้วจึงติดตั้งจริง

```sh
./scripts/install-managed-vps.sh --dry-run --version 1.0.3
./scripts/install-managed-vps.sh --version 1.0.3
```

ถ้ารันจากบัญชีธรรมดา ให้ส่งที่อยู่ทั้งสามผ่าน `sudo` ไปด้วยคำสั่ง `sudo --preserve-env=TOME_CMS_PUBLIC_URL,S3_ENDPOINT,MEDIA_PUBLIC_URL ./scripts/install-managed-vps.sh --version 1.0.3`

ตัวติดตั้งทำงานตามลำดับนี้ และหยุดทันทีที่ขั้นไหนไม่ผ่าน

1. ตรวจว่ารันด้วยสิทธิ์ root บน Linux เป็น `amd64` หรือ `arm64` มี Node.js 22 ที่ `/usr/bin/node` และโค้ดที่ checkout ไว้ไม่มีอะไรถูกแก้และอยู่ตรง tag ของเวอร์ชันที่คุณสั่ง
2. ตรวจว่ายังไม่มีอะไรติดตั้งอยู่ คือโฟลเดอร์ของมันยังว่าง และไม่มี Compose project หรือ volume ชื่อ `tomecms` ตัวติดตั้งไม่ติดตั้งทับการติดตั้งอื่นเด็ดขาด
3. อ่านข้อมูล release จาก GitHub และกำหนดว่า release ต้องเผยแพร่แล้ว เป็นรุ่น stable และแก้ไขไม่ได้ พร้อมไฟล์สามไฟล์ `update-manifest.json`, `update-manifest.attestation.json` และ `tomecms-image.attestation.json` ซึ่งแต่ละไฟล์ต้องตรงกับ digest แบบ SHA-256 ของมัน
4. ตรวจ manifest และ image กับ attestation เหล่านั้นด้วย `gh attestation verify` ทั้งสองต้องมาจาก `release.yml` ใน repository ทางการ ของ tag นี้และ commit นี้ และไม่ได้มาจาก runner แบบ self-hosted
5. สร้างค่าลับ แล้วตรวจว่าที่อยู่ทั้งสามเป็น HTTPS บนชื่อโฮสต์สาธารณะ dry run จะหยุดที่ขั้นนี้ พิมพ์แผนออกมาเป็น JSON และไม่เปลี่ยนแปลงอะไรเลย
6. build ตัวอัปเดต ดึง image ด้วย digest แล้วตรวจแพลตฟอร์ม เวอร์ชัน และ commit ของ image
7. สร้างบัญชีระบบ `tomecms-updater` แล้วเขียนค่าลับลงใน `/etc/tome-cms/tome-cms.env` เขียนไฟล์ Compose ไว้ที่ `/opt/tome-cms` และเขียน service `tomecms-updater`
8. เปิด PostgreSQL และ SeaweedFS รัน migration ของฐานข้อมูล เปิดแอป แล้วตรวจ `/health/ready`
9. เปิด `tomecms-updater` ตรวจว่าตัวอัปเดตรายงานเวอร์ชันที่เพิ่งติดตั้ง แล้วพิมพ์ที่อยู่ของตัวช่วยตั้งค่าครั้งแรกออกมา

ท้ายผลลัพธ์จะหน้าตาแบบนี้

```text
Installer: https://cms.example.com/install
Installation token: sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env
Current version: 1.0.3
Backups: /var/backups/tome-cms
```

รันคำสั่งในบรรทัดที่สองเพื่ออ่าน token ในไฟล์นี้ทุกค่าอยู่ในเครื่องหมายคำพูดเดี่ยว ตอนคัดลอก token ไม่ต้องเอาเครื่องหมายมาด้วย

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

เวอร์ชันต่อ ๆ ไปติดตั้งได้จากหน้าแอดมิน ตามที่หน้า[การอัปเดต](/tome-cms/th/running/updating/) อธิบายไว้

## ถ้าตัวติดตั้งหยุดกลางทาง

ตัวติดตั้งจะพิมพ์ข้อความหนึ่งบรรทัดบอกว่าติดตรงไหน ถ้ายังไม่ได้เขียนไฟล์ของมัน ตัวติดตั้งจะลบทุกอย่างที่สร้างไว้ด้วย คุณจึงแก้ต้นเหตุแล้วรันใหม่ได้ ข้อความที่เจอบ่อยมีดังนี้

| ข้อความ | สิ่งที่ต้องทำ |
| --- | --- |
| `Run installation as root using sudo.` | รันด้วยสิทธิ์ root หรือรันผ่าน `sudo` ตามที่อธิบายไว้ข้างบน |
| `Checkout must match the exact stable release tag.` หรือ `Requested version must equal package.json.` | clone tag ของ release ตามขั้นที่ 1 และให้ `--version` เป็นเวอร์ชันเดียวกัน |
| `Managed installer requires a clean release checkout.` | มีบางอย่างในโค้ดที่ checkout ไว้ถูกแก้ `git status` จะบอกว่าอะไร ให้ clone tag ใหม่อีกครั้ง |
| `Managed installation requires fresh empty destinations; existing files are retained.` หรือ `Managed installation requires fresh Docker project and volumes.` | บนเซิร์ฟเวอร์นี้มี TomeCMS หรือบางส่วนจากการลองครั้งก่อนอยู่แล้ว ให้ติดตั้งบนเซิร์ฟเวอร์เครื่องใหม่ |
| `Invalid or non-immutable official release.` | เวอร์ชันนั้นไม่ใช่รุ่น stable ที่เผยแพร่แล้ว ตรวจ tag ในหน้า Releases |
| `TOME_CMS_PUBLIC_URL is not set.` หรือ `S3_ENDPOINT is not set.` | export ที่อยู่ตามขั้นที่ 2 ใน shell เดียวกับที่ใช้รันตัวติดตั้ง |
| `Port 4321 is unavailable.` (หรือ `5432`, `9000`) | มีโปรแกรมอื่นใช้พอร์ตนั้นอยู่ ส่วนใหญ่เป็นการติดตั้งครั้งก่อนบนเครื่องนี้ การติดตั้งแบบ managed ต้องใช้เซิร์ฟเวอร์ใหม่ |
| `systemd requires Node 22+ installed at /usr/bin/node.` หรือ `Missing 'gh'.` | ติดตั้งสิ่งที่ข้อความระบุ `prepare-vps.sh` ติดตั้งให้ทั้งสองอย่าง |
| `TOME_CMS_PUBLIC_URL requires a browser-reachable public host; local or special-use address forms are not allowed.` | ใช้ชื่อโฮสต์สาธารณะที่ DNS ชี้มาที่เซิร์ฟเวอร์ ไม่ใช่ IP หรือชื่อในเครื่อง |

ถ้าหยุดหลังจากเขียนไฟล์ไปแล้ว ตัวติดตั้งจะพิมพ์ `Managed installation failed; inspect the private diagnostics.` เก็บการตั้งค่า ข้อมูล และ log ไว้ แล้วพิมพ์คำสั่งสำหรับดู log ออกมา หน้า[กลับเข้าหน้าผู้ดูแล](/tome-cms/th/running/recovery/#กู้คืนการติดตั้งแบบ-managed) บอกว่าต้องทำอะไรต่อ

หน้า[แก้ปัญหา](/tome-cms/th/running/troubleshooting/)มีข้อความอื่น ๆ อีก ตั้งแต่ตอนติดตั้งไปจนถึงตอนอัปโหลดไฟล์ พร้อมความหมายของแต่ละข้อความ

## ย้ายมาจาก 0.x

การติดตั้ง 0.x เปลี่ยนเป็นแบบ managed บนเครื่องเดิมไม่ได้ ไม่ว่าจะผ่านหน้าแอดมินหรือรันตัวติดตั้งทับ ให้สำรองข้อมูลเต็มชุดและตรวจว่ากู้คืนได้จริง เก็บค่าลับเดิมไว้ในที่ปลอดภัย แล้วเตรียมเซิร์ฟเวอร์ใหม่แยกต่างหากสำหรับ 1.0.0 ย้ายเนื้อหาไปเองแล้วตรวจบนเครื่องใหม่ สลับ DNS ก็ต่อเมื่อ HTTPS, passkey, เนื้อหา และมีเดียบนเครื่องใหม่ใช้ได้ครบแล้ว และเก็บเครื่องเก่ากับชุดสำรองไว้จนกว่าจะมั่นใจ

## ติดตั้งแบบ build จากซอร์สโค้ด

สคริปต์ deploy (`scripts/deploy-vps.sh`) build image ของแอปบนเซิร์ฟเวอร์จากโค้ดที่ checkout ไว้ที่ไหนก็ได้ เช่น `develop` รุ่น 0.x ติดตั้งด้วยวิธีนี้ การติดตั้งแบบนี้ทำได้แค่ตรวจหาอัปเดต เมนู "ระบบ" จะแสดงว่ามี release ใหม่ แต่ติดตั้งให้ไม่ได้ ถ้า checkout ไว้ที่ tag ของ release ตั้งแต่ `v1.0.0` ขึ้นไป สคริปต์จะส่งต่อให้ตัวติดตั้งแบบ managed แทน

ให้รันด้วยบัญชีที่สั่ง `docker` ได้ ไม่ใช่ root จากโฟลเดอร์โค้ด โดย export ที่อยู่ทั้งสามไว้แล้วตามขั้นที่ 2

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

token ยังเก็บอยู่ใน `.env.local` เปิดดูอีกครั้งภายหลังได้ด้วย `grep '^TOME_CMS_INSTALL_TOKEN=' .env.local`

### ถ้าสคริปต์หยุดกลางทาง

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

### รันซ้ำเพื่ออัปเกรด

การรันสคริปต์อีกครั้งจากโค้ดที่ใหม่กว่า คือวิธีอัปเกรดการติดตั้งแบบ build จากซอร์สโค้ด ก่อนรันให้สำรอง PostgreSQL และ bucket ของมีเดียไว้พร้อมกัน แล้วจึงสั่ง

```sh
git pull
./scripts/deploy-vps.sh
```

สคริปต์จะใช้ `.env.local` เดิมตามที่เป็นอยู่ build image ใหม่ของแอประหว่างที่ตัวเก่ายังให้บริการเว็บอยู่ รัน migration ใหม่ แล้วจึงสลับคอนเทนเนอร์แอปเป็นตัวใหม่
