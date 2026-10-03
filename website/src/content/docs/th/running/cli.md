---
title: คำสั่ง tome
description: ดูแลเซิร์ฟเวอร์แบบ managed ด้วยคำสั่งสั้น ๆ ดูสถานะ อ่าน log สำรองข้อมูล ติดตั้งอัปเดต และล้าง image เก่า ทั้งหมดด้วย sudo tome
sidebar:
  order: 9
---

`tome` คือคำสั่งบนเซิร์ฟเวอร์แบบ managed คำสั่งยาว ๆ อย่าง `docker compose …` และ `curl --unix-socket …` ถูกซ่อนไว้หลังคำสั่งสั้น ๆ ที่รู้อยู่แล้วว่าทุกอย่างอยู่ตรงไหน ได้แก่ `sudo tome status`, `sudo tome logs`, `sudo tome backup`, `sudo tome update` และ `sudo tome prune`

ทุกคำสั่ง

- รันด้วยสิทธิ์ root จึงต้องขึ้นต้นด้วย `sudo` ถ้ารันด้วยผู้ใช้อื่น คำสั่งจะบอกแล้วหยุด
- ไม่แสดงความลับเลย รหัสผ่าน token และ key จาก environment ของเซิร์ฟเวอร์จะถูกซ่อนไว้
- แสดงผลเป็นภาษาอังกฤษ สั้นและตรงไปตรงมา
- รับ `--help` เพื่อแสดงตัวเลือกของคำสั่งนั้น

| Exit code | ความหมาย |
| --- | --- |
| 0 | สำเร็จ |
| 1 | ล้มเหลวหรือถูกปฏิเสธ ข้อความจะบอกว่าเพราะอะไรและควรทำอย่างไร |
| 2 | ใช้คำสั่งผิด เช่น พิมพ์ชื่อคำสั่งหรือตัวเลือกที่ไม่มี คำสั่งจะแสดงวิธีใช้ |

การเปลี่ยนแปลงทุกอย่างผ่านตัวอัปเดต ซึ่งเป็น service เดียวกับที่ติดตั้งอัปเดตจากเมนู "ระบบ" `tome` ไม่เคยหยุด container หรือลบ image เอง

## การติดตั้ง

เซิร์ฟเวอร์ที่ติดตั้งด้วย 1.11.0 ขึ้นไปมี `tome` อยู่แล้ว ส่วนเซิร์ฟเวอร์แบบ managed ที่ติดตั้งมาก่อนหน้านั้น ให้อัปเดตแอปเป็น 1.11.0 จากเมนู "ระบบ" ก่อน ตามที่หน้า[การอัปเดต](/tome-cms/th/running/updating/)อธิบายไว้ แล้วจึงอัปเกรดตัวอัปเดตจาก checkout ของ 1.11.0

```sh
cd /opt/tome-cms-src
git fetch --depth 1 origin tag v1.11.0
git checkout --detach v1.11.0
npm ci
sudo npm run updater:upgrade -- --dry-run
sudo npm run updater:upgrade
```

เซิร์ฟเวอร์ที่ติดตั้งก่อน 1.0.2 จะไม่มี `/opt/tome-cms-src` ให้ clone release มาไว้ที่นั่นแทนสามบรรทัดแรก

```sh
git clone --depth 1 --branch v1.11.0 https://github.com/Dhanabhon/tome-cms.git /opt/tome-cms-src
cd /opt/tome-cms-src
```

คำสั่งเดียวนี้นำตัวอัปเดต 1.5.0 และ `tome` มาให้ โดยติดตั้ง `tome` ไว้ที่ `/usr/local/bin/tome` ตัวอัปเดตต้องเป็นรุ่น 1.5.0 เพราะ `tome backup` และ `tome prune` ใช้คำขอสองแบบที่ตัวอัปเดตรุ่นก่อนไม่มี เมื่อเสร็จจะขึ้นว่า `tome is installed at /usr/local/bin/tome. Try: sudo tome status` ส่วนที่เหลืออยู่ในหัวข้อ[อัปเกรดตัวอัปเดต](/tome-cms/th/running/updating/#อัปเกรดตัวอัปเดต) รวมถึงหน้าที่ของ `--dry-run`

ถ้ามีไฟล์ `/usr/local/bin/tome` อยู่แล้วและไม่ใช่ของ TomeCMS การอัปเกรดจะปฏิเสธก่อนหยุดอะไรทั้งสิ้น และบอกให้ย้ายไฟล์นั้นออกไปก่อน

## tome status

แสดงภาพรวมของเซิร์ฟเวอร์ในหน้าเดียว และไม่เปลี่ยนอะไรเลย

```text
$ sudo tome status
TomeCMS 1.11.0, updater 1.5.0
Site: ready (migrations: ready)
Containers:
  app        running, healthy
  postgres   running, healthy
  seaweedfs  running, healthy
Free disk where backups go: 10.0 GiB (/var/backups/tome-cms)
Last update: 1.11.0 succeeded, finished 2026-10-02 18:05
Newest backup: database, 1.5 MiB, 2 hours ago (/var/backups/tome-cms/tomecms-20261002T100000000Z)
```

เวอร์ชันมาจากตัวอัปเดต บรรทัด Site คือ `/health/ready` ของแอปเอง บรรทัดดิสก์คือดิสก์ที่เก็บ `/var/backups/tome-cms/` เวลาของการอัปเดตครั้งล่าสุดเป็นเวลาท้องถิ่นของเซิร์ฟเวอร์

ใต้บรรทัดดิสก์จะมีคำเตือนเมื่อที่ว่างน้อยกว่า 5 GiB ซึ่งเป็นขั้นต่ำที่การอัปเดตหรือการสำรองข้อมูลต้องใช้ คำเตือนนั้นระบุ `sudo tome prune` ไว้ และถ้าการสำรองข้อมูลค้าง ก็จะมีคำเตือนด้วย ตามหัวข้อ[เมื่อดิสก์เต็ม](#เมื่อดิสก์เต็ม)

| ตัวเลือก | ทำอะไร |
| --- | --- |
| `--json` | แสดงข้อมูลชุดเดียวกันเป็น JSON object ก้อนเดียว สำหรับสคริปต์ |

คำสั่งนี้จบด้วย exit code 1 เฉพาะเมื่ออ่านข้อมูลจากตัวอัปเดตไม่ได้ คือตัวอัปเดตไม่ตอบ หรือตอบกลับมาไม่ตรงกับที่คาดไว้ ส่วนที่เหลือที่อ่านได้ก็ยังแสดงตามปกติ

## tome logs

แสดง log ล่าสุดของ service หนึ่งตัว โดยซ่อนความลับไว้

```sh
sudo tome logs                 # แอป 100 บรรทัด
sudo tome logs postgres -n 20
sudo tome logs updater -f
```

| อาร์กิวเมนต์หรือตัวเลือก | ทำอะไร |
| --- | --- |
| `app`, `postgres`, `seaweedfs` หรือ `updater` | service ที่ต้องการ ถ้าไม่ระบุคือ `app` |
| `-n N`, `--lines N` | จำนวนบรรทัด ตั้งแต่ 1 ค่าเริ่มต้นคือ 100 |
| `-f`, `--follow` | แสดงบรรทัดใหม่ต่อไปจนกว่าจะกด Ctrl+C |

สามตัวแรกมาจาก `docker compose logs` ส่วน `updater` มาจาก journal ของ service `tomecms-updater` เพื่อซ่อนความลับ `tome` จะอ่านไฟล์ environment ของเซิร์ฟเวอร์ก่อน ถ้าอ่านไม่ได้ หรือซ่อนสิ่งที่อยู่ในนั้นอย่างปลอดภัยไม่ได้ จะบอกเหตุผล ไม่แสดงอะไรเลย และจบด้วย exit code 1

## tome backup

ขอให้ตัวอัปเดตสำรองข้อมูล แล้วแสดงแต่ละขั้นตามที่เกิดขึ้น

```text
$ sudo tome backup
Back up the database? The site is in maintenance while it runs, about 3 minutes last time. [y/N] y
[1/3] Prepare maintenance
[2/3] Create the backup
[3/3] Restart TomeCMS
Backup saved to /var/backups/tome-cms/tomecms-20261002T110000000Z (12.0 MiB).
```

**เว็บจะปิดอยู่ช่วงสั้น ๆ** ตัวอัปเดตจะเปิดหน้าปิดปรับปรุง หยุดแอป สำรองข้อมูล เปิดแอปอีกครั้ง และรอจนแอปพร้อม เป็นขั้นตอนเดียวกับการสำรองข้อมูลในการอัปเดต และเปิดแอปกลับมาเสมอ แม้การสำรองข้อมูลจะล้มเหลว คำถามก่อนเริ่มบอกว่าการสำรองข้อมูลแบบเดียวกันครั้งก่อนใช้เวลานานเท่าไร ถ้ายังไม่เคยมี จะบอกว่า "for a few minutes" และเมื่อใช้ `--full` จะบอกด้วยว่าอาจนานกว่านั้น เพราะต้องคัดลอกไฟล์สื่อด้วย

โดยค่าเริ่มต้นชุดสำรองมีเฉพาะฐานข้อมูล ซึ่งเร็ว ถ้าใส่ `--full` จะมี bucket ของมีเดียด้วย และเว็บจะปิดนานขึ้น หน้า[สำรองและกู้คืนข้อมูล](/tome-cms/th/running/backups/)อธิบายว่าทำไมคุณยังควรเก็บสำเนามีเดียของตัวเองไว้

| ตัวเลือก | ทำอะไร |
| --- | --- |
| `--full` | สำรองมีเดียด้วย ไม่ใช่แค่ฐานข้อมูล |
| `-y`, `--yes` | ไม่ถามก่อน |

คำสั่งนี้ปฏิเสธและจบด้วย exit code 1 เมื่อมีการอัปเดต การสำรองข้อมูลอื่น หรือการล้าง image เก่ากำลังรันอยู่ เมื่อที่ว่างตรงที่เก็บชุดสำรองน้อยกว่า 5 GiB และเมื่อการอัปเดตครั้งล่าสุดต้องกู้คืนด้วยมือ ถ้าคุณตอบว่าไม่ จะขึ้นว่า `Nothing was done.` และจบด้วย exit code 1

## tome update

ติดตั้ง release stable ล่าสุด หรือเวอร์ชันที่คุณระบุ แบบเดียวกับเมนู "ระบบ"

```sh
sudo tome update
sudo tome update 1.11.0
```

ถ้าไม่ระบุเวอร์ชัน คำสั่งจะถาม GitHub หา release stable ล่าสุด ด้วยการตรวจแบบเดียวกับที่หน้าแอดมินใช้ แล้วแสดงเทียบกับเวอร์ชันที่ติดตั้งอยู่ พร้อมลิงก์ไปยังบันทึกการเปลี่ยนแปลง ถ้าคุณใช้เวอร์ชันนั้นอยู่แล้ว จะขึ้นว่า `TomeCMS 1.11.0 is up to date.` และจบด้วย exit code 0 จากนั้นจะถามว่า

```text
Install 1.11.0? The updater checks the release, backs up the database (or everything, when the release has a migration) and puts the site in maintenance for a few minutes. [y/N]
```

ตอบ `y` แล้วคำสั่งจะติดตามการอัปเดตจนจบ แสดงทีละขั้นด้วยชื่อเดียวกับที่เมนู "ระบบ" ใช้ ตั้งแต่ `[1/8] Check prerequisites` ถึง `[8/8] Check application health` แล้วขึ้นว่า `TomeCMS 1.11.0 is installed.` ถ้าการอัปเดตล้มเหลว จะแสดงความหมายของรหัสข้อผิดพลาด สิ่งที่ควรทำ และบอกว่าตอนนี้เวอร์ชันไหนรันอยู่

**ตรงนี้ไม่มี passkey** เมนู "ระบบ" ขอ passkey เพื่อให้แน่ใจว่าเป็นคุณที่นั่งอยู่หน้าเครื่อง แต่การรัน `sudo` บนเซิร์ฟเวอร์ก็หมายถึงควบคุมเซิร์ฟเวอร์ได้เต็มที่อยู่แล้ว passkey จึงไม่ได้พิสูจน์อะไรเพิ่ม ส่วนที่เหลือเหมือนในหน้าแอดมินทุกอย่าง ตัวอัปเดตยังตรวจ release กับ attestation ตรวจว่าเข้ากันได้ สำรองข้อมูล และคืนเวอร์ชันเดิมเมื่อเวอร์ชันใหม่เปิดไม่ขึ้น

| อาร์กิวเมนต์หรือตัวเลือก | ทำอะไร |
| --- | --- |
| `version` | release ที่ระบุตรง ๆ เช่น `1.11.0` ถ้าเป็นเวอร์ชันที่ติดตั้งอยู่แล้ว จะบอกว่าเป็นรุ่นล่าสุดแล้วและจบด้วย exit code 0 มีเพียงเวอร์ชันที่เก่ากว่าเท่านั้นที่ถูกปฏิเสธ |
| `-y`, `--yes` | ไม่ถามก่อน |

คำสั่งนี้จบด้วย exit code 1 เมื่อคุณตอบว่าไม่ เมื่อ release นั้นติดตั้งตรง ๆ บนเซิร์ฟเวอร์นี้ไม่ได้ เมื่อตัวอัปเดตของเซิร์ฟเวอร์เก่าเกินไปสำหรับ release นั้น (ข้อความจะบอก `sudo npm run updater:upgrade`) เมื่อเข้า GitHub ไม่ได้ และเมื่อมีการอัปเดต การสำรองข้อมูล หรือการล้าง image เก่ากำลังรันอยู่

## tome prune

ล้าง image ของ TomeCMS รุ่นเก่าที่การอัปเดตแต่ละครั้งเคยทิ้งไว้บนดิสก์ ถ้าไม่ใส่ `--yes` จะเป็นแค่การลองรันโดยไม่ลบจริง

```text
$ sudo tome prune
These old application images can go:
  sha256:bbbbbbbbbbbb  1.1 GiB
  sha256:cccccccccccc  718 MiB
Total: about 1.8 GiB.
Remove them with: sudo tome prune --yes
```

`sudo tome prune --yes` จะลบ image เหล่านั้น แล้วแสดงรายการที่ลบ (`Removed sha256:…`) และ `Freed about 1.8 GiB.` ตัวอัปเดตใช้กฎเดียวกับที่ใช้หลังอัปเดตสำเร็จ

- เฉพาะ image ของแอปทางการ `ghcr.io/dhanabhon/tome-cms`
- เฉพาะตัวที่ไม่มี tag และไม่แตะ image ของ PostgreSQL หรือ SeaweedFS
- เก็บ image ที่ติดตั้งอยู่และตัวก่อนหน้าไว้เสมอ เพราะการย้อนกลับต้องใช้
- ไม่ลบอะไรเลยถ้าอ่านรายการ image จาก Docker ได้ไม่ครบ คำสั่งจะบอกและจบด้วย exit code 1

image ที่ container ที่หยุดอยู่ยังใช้จะลบไม่ได้ และ `tome` จะบอกว่าเหลือไว้กี่ตัว ถ้าไม่มีอะไรให้ลบจะขึ้นว่า `No old application images to remove.` และจบด้วย exit code 0 คำสั่งนี้ปฏิเสธเมื่อมีการอัปเดต การสำรองข้อมูล หรือการล้าง image อีกครั้งหนึ่งกำลังรันอยู่

| ตัวเลือก | ทำอะไร |
| --- | --- |
| `-y`, `--yes` | ลบ image แทนที่จะแสดงรายการเฉย ๆ |

## สร้างธีมและปลั๊กอิน

อีกสามคำสั่งช่วยคุณเขียนธีมหรือปลั๊กอิน คำสั่งเหล่านี้ไม่ได้มีไว้ใช้บนเซิร์ฟเวอร์ แต่รันใน source checkout ของ TomeCMS ด้วย `npm run tome --` ไม่ต้องใช้ `sudo` และถ้ารันที่อื่นจะขึ้นว่า `Run this in a TomeCMS source checkout.` แล้วจบด้วย exit code 1 รวมถึงเมื่อรัน `tome` ที่ติดตั้งบนเซิร์ฟเวอร์ ส่วนคำสั่งสำหรับเซิร์ฟเวอร์ข้างต้นยังต้องใช้ `sudo` เหมือนเดิม สองกลุ่มนี้ไม่ปะปนกัน

```sh
npm run tome -- theme new <id> [--from plain|paper|almanac] [--dry-run]
npm run tome -- plugin new <id> --hook publicPage|signIn|editorSuggestions [--client] [--dry-run]
npm run tome -- check
```

- `theme new` คัดลอกธีมที่มีอยู่ไปเป็น id ใหม่และลงทะเบียนให้ หน้า[เขียนธีม](/tome-cms/th/extending/themes/#เริ่มต้นด้วย-tome)อธิบายว่าคำสั่งเปลี่ยนชื่ออะไรบ้าง
- `plugin new` เขียนปลั๊กอินที่เสียบกับ hook ของมันแต่ยังไม่ทำอะไร และปิดอยู่ หน้า[เขียนปลั๊กอิน](/tome-cms/th/extending/plugins/#เริ่มต้นด้วย-tome)แสดงว่าคำสั่งเขียนอะไรให้
- `check` ตรวจธีมและปลั๊กอินทุกตัว และแสดงปัญหาแต่ละข้อในรูป `path:line: what is wrong` คำสั่งนี้ไม่เปลี่ยนอะไรเลย จบด้วย exit code 0 เมื่อไม่พบปัญหา และ 1 เมื่อพบ `npm run check` รันคำสั่งนี้ด้วย CI จึงหยุดข้อผิดพลาดได้ก่อน merge

`check` ตรวจสิ่งเหล่านี้

1. ธีมหรือปลั๊กอินที่ชื่อโฟลเดอร์ไม่ตรงกับ id ใน manifest
2. ตัวที่ไม่อยู่ครบทั้งใน `manifests.ts` และ `registry.ts` หรือรายการที่ไม่มีโฟลเดอร์รองรับ
3. ไฟล์ที่ขาด ธีมต้องมี `index.ts`, `theme.ts`, `Shell.astro`, `Home.astro`, `Post.astro`, `Page.astro` และ `theme.css` ปลั๊กอินต้องมี `plugin.ts` และ `index.ts` และมี `client.ts` เมื่อมี `publicClient`
4. การตั้งค่าที่รูปแบบไม่ถูกต้อง เช่น key ซ้ำ ชนิดที่ข้อตกลงไม่อนุญาต label หรือ hint ที่ขาดภาษาอังกฤษหรือภาษาไทย choice ที่ไม่มีตัวเลือกหรือที่ค่า fallback ไม่ใช่หนึ่งในตัวเลือก text ที่ไม่มีความยาวสูงสุด และ switch ที่ fallback ไม่ใช่ `on` หรือ `off`
5. ปลั๊กอินที่ไม่มีเมธอดของ hook ที่ประกาศไว้ หรือไม่มีเมธอดคู่ sign-in ที่ปลั๊กอินทุกตัวต้องตอบ
6. ธีมที่ import จาก `src/server/`
7. สไตล์ชีตของธีมที่ไม่ได้ใช้ design token เท่านั้น

คำสั่งนี้ไม่รันปลั๊กอิน แค่โหลดโมดูลแล้วดูว่าส่งออกอะไร ผลลัพธ์มีหน้าตาดังนี้ โดยปัญหาในตัวอย่างเป็นเพียงภาพประกอบ

```text
$ npm run tome -- check
src/plugins/nimbus/index.ts:1: <what is wrong>
```

`npm run tome -- --help` แสดงรายการคำสั่งเหล่านี้ และทุกคำสั่งรับ `--help`

## เมื่อดิสก์เต็ม

ดิสก์เต็มคือตอนที่ `tome` ช่วยได้มากที่สุด เมื่อที่ว่างตรงที่เก็บชุดสำรองน้อยกว่า 5 GiB การอัปเดตหรือการสำรองข้อมูลจะปฏิเสธด้วยข้อความ `Not enough free disk space where backups go` และ `tome status` จะแสดงคำเตือน

1. ดูว่าเหลือที่ว่างเท่าไร และ image เก่าตัวไหนลบได้

   ```sh
   sudo tome status
   sudo tome prune
   ```

2. ลบ image ด้วย `sudo tome prune --yes` ตัวอัปเดตไม่เคยลบชุดสำรองเก่า ชุดไหนอยากเก็บให้คัดลอกออกจากเซิร์ฟเวอร์ แล้วจึงลบออกจาก `/var/backups/tome-cms/`
3. รัน `sudo tome status` อีกครั้งเพื่อดูที่ว่างใหม่

ถ้าดิสก์เต็มระหว่างที่การสำรองข้อมูลกำลังรัน ตัวอัปเดตอาจเขียนบันทึกตอนจบไม่ได้ `tome status` จะเตือนว่าการสำรองข้อมูลค้าง ทั้งที่ไม่มีงานรันอยู่

```text
Warning: A backup is stuck at "backing_up" with no job running: the updater could not write its end, most likely because the disk is full. Free some space (sudo tome prune shows old images that can go), then run: sudo systemctl restart tomecms-updater
```

ให้เพิ่มที่ว่างก่อน แล้วจึงรีสตาร์ตตัวอัปเดต

```sh
sudo systemctl restart tomecms-updater
```

ตัวอัปเดตเปิดแอปกลับมาให้แม้เขียนบันทึกไม่ได้ แต่จนกว่าจะรีสตาร์ต บันทึกที่ค้างจะปฏิเสธการอัปเดตและการสำรองข้อมูลต่อไป เมื่อเริ่มใหม่ ตัวอัปเดตจะปิดบันทึกนั้น และเปิดแอปถ้าแอปปิดอยู่ หน้า[แก้ปัญหา](/tome-cms/th/running/troubleshooting/)รวบรวมข้อความที่คุณอาจเจอไว้
