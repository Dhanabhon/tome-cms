---
title: การทดสอบ
description: คำสั่งทดสอบทุกคำสั่งใน repository แต่ละคำสั่งต้องมีอะไรก่อนรัน และชุดบริการแบบใช้แล้วทิ้งที่คำสั่งซึ่งใช้เวลานานเปิดขึ้นมาเอง
sidebar:
  order: 3
---

ทุกคำสั่งในหน้านี้รันจากโฟลเดอร์ของโปรเจกต์ หลังจากติดตั้งแพ็กเกจตามเวอร์ชันที่ล็อกไว้แล้ว

```sh
npm ci
```

หน้า[เตรียมเครื่องสำหรับพัฒนา](/tome-cms/th/contributing/setup/) อธิบายเรื่อง Node.js กับ Docker ไว้แล้ว ไม่มีคำสั่งไหนในหน้านี้ใช้ PostgreSQL, SeaweedFS หรือ Astro ที่ `npm run dev:macos` เปิดไว้ ข้อมูลที่คุณใช้พัฒนาอยู่จึงไม่ถูกแตะต้อง

## คำสั่งทั้งหมด

| คำสั่ง | รันอะไร | ต้องมีอะไร |
| --- | --- | --- |
| `npm run check` | `astro check` การทดสอบตัวเองของสคริปต์สำรองข้อมูล กู้คืน รีเซ็ต ฟอนต์ และสไตล์ชีต การตรวจไวยากรณ์ของสคริปต์เชลล์สองตัว และการตรวจ design token | Node.js กับ bash |
| `npm run test:unit` | ทุกไฟล์ใต้ `tests/unit/` | Node.js กับ bash |
| `npm run build` | build สำหรับใช้งานจริง | Node.js |
| `npm run test:operations` | `tests/operations/fresh-install.test.ts` ซึ่งตรวจว่าสคริปต์สำรองข้อมูล รีเซ็ต และกู้คืน ไม่ยอมทำงานถ้าไม่ได้ระบุเป้าหมายไว้ชัดและแคบพอ | Node.js |
| `npm run test:integration:foundation` | การตรวจความพร้อม หรือไฟล์ integration ที่คุณระบุ | Docker และพอร์ต `55432` กับ `59000` ที่ว่าง |
| `npm run test:integration` | ทุกไฟล์ใต้ `tests/integration/` ทีละไฟล์ | Docker และพอร์ต `55432` กับ `59000` ที่ว่าง |
| `npm run test:e2e` | เทสต์ในเบราว์เซอร์ใต้ `tests/e2e/` บน Playwright ทั้งสอง project | Docker, พอร์ต `55432` กับ `59000` ที่ว่าง และ Chromium ของ Playwright |
| `npm run test:operations:update` | ชุดทดสอบการอัปเดตแบบ managed | Docker Engine ที่มี Compose, image ที่ตรึงเวอร์ชันไว้ และคอมไพเลอร์ของภาษา Go |

สี่คำสั่งแรกไม่ต้องใช้ Docker แบบฟอร์ม pull request ขอให้รัน `npm run check` กับ `npm run test:unit` และรันไฟล์ integration กับเทสต์ในเบราว์เซอร์ที่การแก้ของคุณเกี่ยวข้อง ทุก pull request จะผ่าน CI ซึ่งรัน `check`, `test:unit`, `build`, เทสต์ integration ทั้งชุด และเทสต์ในเบราว์เซอร์ทุกไฟล์

## เทสต์ระดับหน่วย

`npm run test:unit` ใช้ตัวรันเทสต์ที่มากับ Node รันทุกไฟล์ใน `tests/unit/` เทสต์ที่ต้องเรียกสคริปต์ซึ่งใช้ `docker`, `git` หรือ `systemctl` จะรันสคริปต์นั้นด้วย `PATH` ที่มีแต่คำสั่งตัวแทน คำสั่งตัวแทนเหล่านี้แค่จดไว้ว่าถูกสั่งให้ทำอะไร จึงไม่มีอะไรในเครื่องของคุณถูกเปลี่ยน

`tests/unit/managed-installer.test.ts` รันสคริปต์ติดตั้งผ่าน `/bin/bash` และให้เวลาแต่ละรอบ 20 วินาที ถ้าเครื่องกำลังทำงานหนัก ไฟล์นี้อาจไม่ผ่านเพราะเหตุนี้อย่างเดียว ก่อนจะเชื่อว่าไฟล์นี้พังจริง ให้รันไฟล์นี้แยกเดี่ยว ๆ ก่อน

```sh
node --import tsx --test tests/unit/managed-installer.test.ts
```

ด้วยเหตุผลเดียวกัน อย่ารันเทสต์ระดับหน่วยทั้งชุดในช่วงที่เทสต์ในเบราว์เซอร์กำลังเปิดหรือกำลังรื้อ container ของตัวเอง

## เทสต์ integration

`scripts/test-foundation.mjs` เป็นตัวรันเทสต์ integration สคริปต์นี้เปิด PostgreSQL 17 กับ SeaweedFS 4.46 จาก `compose.test.yaml` ในชื่อ project ของ Compose ว่า `tomecms-foundation-test` ที่ `127.0.0.1:55432` และ `127.0.0.1:59000` ข้อมูลของทั้งสองตัวอยู่ในหน่วยความจำ เมื่อรันจบ ต่อให้มีเทสต์ไม่ผ่านหรือกด `Ctrl+C` ตัวรันก็จะลบ container และ volume ของทั้งสองตัวทิ้ง

```sh
npm run test:integration:foundation
node scripts/test-foundation.mjs tests/integration/<file>.test.ts
npm run test:integration
```

- ถ้าไม่ระบุไฟล์ ตัวรันจะรันการตรวจความพร้อม คือ `tests/integration/foundation.test.ts` โดยเปิดทั้งสองบริการ
- ถ้าระบุไฟล์ ตัวรันจะรันเฉพาะไฟล์เหล่านั้น และเปิด SeaweedFS ก็ต่อเมื่อมีไฟล์ที่ต้องคุยกับที่เก็บไฟล์ ไฟล์ที่ใช้แค่ฐานข้อมูลจึงได้ PostgreSQL อย่างเดียว คำสั่ง `npm run test:integration:foundation -- tests/integration/<file>.test.ts` ทำแบบเดียวกัน
- `npm run test:integration` ส่ง `--all` ให้ตัวรัน ซึ่งจะรันทุกไฟล์ทีละไฟล์โดยเปิดทั้งสองบริการ ใช้ `--all` คู่กับชื่อไฟล์ไม่ได้

ก่อนรันแต่ละไฟล์ ตัวรันจะล้างฐานข้อมูลให้ว่าง และทุกไฟล์จะปรับฐานข้อมูลตาม migration ใหม่ตั้งแต่ต้น

## เทสต์ในเบราว์เซอร์

เทสต์แต่ละไฟล์ใต้ `tests/e2e/` ที่ต้องใช้ฐานข้อมูลจะเปิด PostgreSQL กับ SeaweedFS ชุดของตัวเองจาก `compose.test.yaml` ในชื่อ project ของ Compose ที่ตั้งตามไฟล์นั้น เช่น `tomecms-signin-test` หรือ `tomecms-stats` จากนั้นจึงเปิดเซิร์ฟเวอร์สำหรับพัฒนาของ Astro บนพอร์ตที่ว่างอยู่ และรื้อชุดนั้นทิ้งเมื่อเทสต์จบ ส่วน `passkey-installer.spec.ts` ไม่ต้องใช้ฐานข้อมูล จึงเปิดแค่เซิร์ฟเวอร์

Playwright ทั้งสอง project ใช้ Chromium คือ `desktop` ที่จำลองเป็น Desktop Chrome และ `mobile` ที่จำลองเป็น Pixel 5 เทสต์ที่ต้องลงชื่อเข้าใช้จะใช้พาสคีย์เสมือน ซึ่งสั่งงานผ่าน Chrome DevTools Protocol ที่มีแต่ Chromium เข้าใจ ติดตั้งเบราว์เซอร์นี้ครั้งเดียวด้วยคำสั่ง

```sh
npx playwright install chromium
```

บน Linux ให้ใช้ `npx playwright install --with-deps chromium` เพื่อติดตั้งไลบรารีของระบบที่เบราว์เซอร์ต้องใช้ไปด้วย แบบเดียวกับที่ CI ทำ ถ้าจะรันเทสต์ไฟล์เดียวบนทั้งสอง project

```sh
npm run test:e2e -- tests/e2e/<file>.spec.ts
```

Playwright รันเทสต์ทีละไฟล์ เพราะทุกไฟล์ใช้แถวการตั้งค่าของเว็บแถวเดียวกัน

## พอร์ต 55432 กับ 59000

ตัวรันเทสต์ integration เทสต์ในเบราว์เซอร์ทุกไฟล์ และสคริปต์ถ่ายภาพหน้าจอของเว็บเอกสาร `npm run docs:screenshots` ต่างเปิด PostgreSQL ที่พอร์ต `55432` และ SeaweedFS ที่พอร์ต `59000` จึงรันได้ทีละอย่างเท่านั้น รอให้อย่างหนึ่งจบและลบ container ของตัวเองเสร็จก่อน แล้วค่อยเริ่มอย่างถัดไป

## ชุดทดสอบการอัปเดตแบบ managed

`npm run test:operations:update` รัน `tests/operations/managed-update.test.ts` ซึ่งทดสอบตัวอัปเดตที่จะมากับ 1.0.0 กับ container จริง สิ่งที่ต้องมีคือ

- Docker Engine ที่มี Compose บนเครื่องแบบ amd64 หรือ arm64
- image `postgres:17-alpine` กับ `chrislusf/seaweedfs:4.46` หรือสิทธิ์ในการดึง image ทั้งสองมา
- คอมไพเลอร์ของภาษา Go

ชุดทดสอบนี้คอมไพล์เซิร์ฟเวอร์เล็ก ๆ ที่เขียนด้วย Go ขึ้นมาแทนแอป TomeCMS แล้ว build เป็น image ในเครื่องสองตัว ติดป้ายว่า `1.0.0` กับ `1.0.1` จากนั้นเปิดตัวแรกพร้อม PostgreSQL, SeaweedFS, network และ volume ของมัน ภายใต้ project ของ Compose ตัวเดียวที่ตั้งชื่อแบบสุ่มขึ้นต้นด้วย `tomecms-test-*` แล้วให้บริการตัวอัปเดตตัวจริงจาก `src/updater/` อัปเดตชุดนั้นไปเป็น `1.0.1` ผ่าน Unix socket ของมัน ตัวอัปเดตจะหยุดแอป สำรองข้อมูล รัน migration ตรวจความพร้อม สลับ image และย้อนกลับไปที่ `1.0.0` ถ้ารุ่นใหม่ไม่ผ่านการตรวจความพร้อม

มีสามส่วนที่ใช้ของแทน คือการดาวน์โหลดและการตรวจ attestation กับ GitHub การจับคู่ digest ของ image ทางการเข้ากับ image ในเครื่อง และการตรวจรายการ migration ของรุ่นเป้าหมาย

ชุดทดสอบลงทะเบียนขั้นตอนเก็บกวาดไว้ก่อนจะ build อะไรทั้งนั้น ขั้นตอนนี้ลบเฉพาะสิ่งที่ติดป้ายของรอบนี้ และเทสต์จะไม่ผ่านถ้ายังมี container, network, volume, image หรือโฟลเดอร์ชั่วคราวที่ตรงกันหลงเหลืออยู่ ชุดทดสอบไม่ยอมใช้ชื่อ project ที่ใช้บนเซิร์ฟเวอร์จริง คือ `tomecms` และไม่ยอมแตะที่อยู่ไฟล์ของเซิร์ฟเวอร์จริง

การผ่านชุดทดสอบนี้เป็นการตรวจบนเครื่องของคุณเอง ก่อน 1.0.0 จะออก รุ่นนั้นยังต้องผ่านการทดสอบบนเซิร์ฟเวอร์ Ubuntu แบบใช้แล้วทิ้ง ทั้ง `linux/amd64` และ `linux/arm64` โดยตรวจกับ GitHub และ GHCR ตัวจริง ตรวจ systemd ตัวช่วยตั้งค่าผ่าน HTTPS พาสคีย์ รวมถึงเนื้อหาและไฟล์สื่อ

## เว็บเอกสาร

เว็บนี้อยู่ใน `website/` และมีแพ็กเกจของตัวเอง เอกสารอ้างอิงของ API สร้างจาก `src/server/http/openapi.ts` และไม่ได้ commit ไว้ จึงต้องสร้างก่อนตรวจครั้งแรก

```sh
npm ci --prefix website
npm run docs:openapi
npm --prefix website run check
npm --prefix website run build
npm run docs:check-search
```

`check` รัน `astro check` แล้วจะไม่ผ่านถ้ามีหน้าที่ไม่มีคู่ในอีกภาษา หรือมีเครื่องหมาย em dash หรือ en dash หรือมีคำที่กฎการเขียนห้ามใช้ `build` ตรวจลิงก์ระหว่างหน้าทุกลิงก์ด้วย ส่วน `docs:check-search` เปิดตัวอย่างของเว็บที่ build แล้วบนพอร์ต `4331` ค้นหาคำภาษาไทยหนึ่งคำและคำภาษาอังกฤษหนึ่งคำด้วย Chromium ของ Playwright แล้วปิดตัวอย่างนั้น คำสั่งนี้จะไม่ยอมเริ่มถ้ามีอะไรตอบอยู่ที่พอร์ตนั้นแล้ว
