---
title: คำสั่ง tome
description: ดูแลเซิร์ฟเวอร์แบบ managed ด้วยคำสั่งสั้น ๆ ดูสถานะ อ่าน log สำรองข้อมูล กู้คืนชุดสำรอง ติดตั้งอัปเดต ล้าง image เก่า และย้ายข้อความของเว็บเป็น Markdown ทั้งหมดด้วย sudo tome
sidebar:
  order: 9
---

`tome` คือคำสั่งบนเซิร์ฟเวอร์แบบ managed คำสั่งยาว ๆ อย่าง `docker compose …` และ `curl --unix-socket …` ถูกซ่อนไว้หลังคำสั่งสั้น ๆ ที่รู้อยู่แล้วว่าทุกอย่างอยู่ตรงไหน ได้แก่ `sudo tome status`, `sudo tome logs`, `sudo tome backup`, `sudo tome update` และ `sudo tome prune` อีกสามคำสั่งใช้ใส่ชุดสำรองกลับเข้าเว็บและย้ายข้อความของคุณ ได้แก่ `sudo tome restore`, `sudo tome export` และ `sudo tome import`

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

การเปลี่ยนแปลงส่วนใหญ่ผ่านตัวอัปเดต ซึ่งเป็น service เดียวกับที่ติดตั้งอัปเดตจากเมนู "ระบบ" `tome` ไม่เคยหยุด container หรือลบ image เอง ข้อยกเว้นคือ `export` และ `import` สองคำสั่งนี้รันใน container ชั่วคราวของแอปที่ติดตั้งอยู่ ซึ่ง `tome` เป็นคนเริ่มและลบเอง และเว็บเปิดอยู่ตลอด

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

`tome restore`, `tome export` และ `tome import` มาพร้อม 1.13.0 ซึ่งนำตัวอัปเดต 1.6.0 มาด้วย ให้อัปเดตแอปเป็น 1.13.0 จากเมนู "ระบบ" แล้วอัปเกรดตัวอัปเดตอีกครั้งจาก checkout ของ v1.13.0 ด้วยคำสั่งชุดเดิมข้างบน ก่อนหน้านั้น `tome` บนเซิร์ฟเวอร์ยังเป็นตัวเก่า ซึ่งไม่รู้จักคำสั่งเหล่านี้ มันจะแสดงวิธีใช้และจบด้วย exit code 2 คำสั่ง `sudo npm run updater:upgrade` จาก checkout ของ v1.13.0 ติดตั้งทั้งตัวอัปเดตใหม่และ `tome` ตัวใหม่

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

ระหว่างที่การกู้คืนกำลังรัน จะมีบรรทัด `Restore` แสดงอยู่เหนือบรรทัดชุดสำรองล่าสุด

```text
Restore running: at "restoring" since 2026-10-03 11:00
```

การกู้คืนที่บันทึกหยุดนิ่งโดยไม่มีงานรันอยู่จะถูกเตือนว่าค้าง เหมือนการสำรองข้อมูล ส่วนการกู้คืนที่ล้มเหลวและทิ้งเว็บไว้ในโหมดปิดปรับปรุงจะมีคำเตือนขึ้นต้นว่า `Warning: a restore failed (rollback_failed) and keeps the site in maintenance.` ตามด้วยขั้นตอนออกจากสถานะนั้น ซึ่งหน้า[กลับเข้าหน้าผู้ดูแล](/tome-cms/th/running/recovery/#การกู้คืนที่ทำให้เว็บค้างในโหมดปิดปรับปรุง)อธิบายไว้ ถ้าตัวอัปเดตอ่านบันทึกของการกู้คืนไม่ได้ จะมีหนึ่งบรรทัดบอก `Restore: could not be read (…). Check it with: sudo tome logs updater` และส่วนอื่นยังแสดงตามปกติ บันทึกของการสำรองข้อมูลก็เช่นกัน โดยขึ้นว่า `Backup: could not be read (…)` เมื่อใช้ `--json` ข้อมูลชุดเดียวกันอยู่ในฟิลด์ `restore` ซึ่งเป็น `null` เมื่อไม่มีการกู้คืนที่กำลังรันหรือรอการแก้ไข

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

คำสั่งนี้ปฏิเสธและจบด้วย exit code 1 เมื่อมีการอัปเดต การสำรองข้อมูลอื่น การกู้คืน หรือการล้าง image เก่ากำลังรันอยู่ เมื่อที่ว่างตรงที่เก็บชุดสำรองน้อยกว่า 5 GiB และเมื่อการอัปเดตครั้งล่าสุดต้องกู้คืนด้วยมือ และเมื่อการกู้คืนที่ล้มเหลวทิ้งเว็บไว้ในโหมดปิดปรับปรุง ถ้าคุณตอบว่าไม่ จะขึ้นว่า `Nothing was done.` และจบด้วย exit code 1

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

คำสั่งนี้จบด้วย exit code 1 เมื่อคุณตอบว่าไม่ เมื่อ release นั้นติดตั้งตรง ๆ บนเซิร์ฟเวอร์นี้ไม่ได้ เมื่อตัวอัปเดตของเซิร์ฟเวอร์เก่าเกินไปสำหรับ release นั้น (ข้อความจะบอก `sudo npm run updater:upgrade`) เมื่อเข้า GitHub ไม่ได้ และเมื่อมีการอัปเดต การสำรองข้อมูล การกู้คืน หรือการล้าง image เก่ากำลังรันอยู่

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

image ที่ container ที่หยุดอยู่ยังใช้จะลบไม่ได้ และ `tome` จะบอกว่าเหลือไว้กี่ตัว ถ้าไม่มีอะไรให้ลบจะขึ้นว่า `No old application images to remove.` และจบด้วย exit code 0 คำสั่งนี้ปฏิเสธเมื่อมีการอัปเดต การสำรองข้อมูล การกู้คืน หรือการล้าง image อีกครั้งหนึ่งกำลังรันอยู่

| ตัวเลือก | ทำอะไร |
| --- | --- |
| `-y`, `--yes` | ลบ image แทนที่จะแสดงรายการเฉย ๆ |

## tome restore

ใส่ชุดสำรองกลับเข้าเว็บ **ทุกอย่างในเว็บจะถูกแทนที่ด้วยชุดสำรอง** ทั้งบทความ เพจ การตั้งค่า และบัญชี และถ้าเป็นชุดสำรองเต็มก็รวมมีเดียด้วย

```sh
sudo tome restore /var/backups/tome-cms/tomecms-20261001T100000000Z
```

```text
$ sudo tome restore /var/backups/tome-cms/tomecms-20261001T100000000Z
Backup: /var/backups/tome-cms/tomecms-20261001T100000000Z
Made 2026-10-01 17:00 by TomeCMS 1.12.1, for https://example.com.
It holds the database and media: 12 posts, 3 pages, 40 media items.
Everything on this site will be replaced by the backup.
Restore this backup? [y/N] y
[1/7] Check the backup
[2/7] Prepare maintenance
[3/7] Create the safety backup
[4/7] Restore the backup
[5/7] Apply database migrations
[6/7] Restart TomeCMS
[7/7] Check the restored site
Restored: 12 posts, 3 pages, 40 media items.
Migrations ran.
The site as it was before the restore is kept in /var/backups/tome-cms/tomecms-20261003T110100000Z.
```

ชุดสำรองจะเป็นชุดที่ `tome backup` สร้าง ทั้งแบบเต็มหรือเฉพาะฐานข้อมูล ชุดที่การอัปเดตสร้าง หรือชุดที่คัดลอกมาจากเซิร์ฟเวอร์อื่นก็ได้ ถ้าเป็นชุดที่มีเฉพาะฐานข้อมูล ข้อความสรุปจะขึ้นว่า `It holds the database only` และ `its media stay as they are` และการกู้คืนจะไม่แตะมีเดีย หัวข้อ[ย้ายไปเซิร์ฟเวอร์เครื่องใหม่](/tome-cms/th/running/backups/#ย้ายไปเซิร์ฟเวอร์เครื่องใหม่)แสดงวิธีคัดลอก

ชุดสำรองต้องเป็นดังนี้

- **อยู่ตรง ๆ ใน `/var/backups/tome-cms`** ไม่ใช่ในโฟลเดอร์ย่อยข้างใน และไม่ใช่ลิงก์ที่ชี้ไปที่อื่น
- **สร้างไว้สำหรับที่อยู่ของเว็บนี้** การกู้คืนไม่เปลี่ยนโดเมน passkey จึงยังใช้ได้
- **สร้างโดย TomeCMS รุ่นนี้หรือรุ่นเก่ากว่า** ชุดสำรองจากรุ่นที่ใหม่กว่าจะถูกปฏิเสธ
- **ครบถ้วน** มี `manifest.json` ทุกไฟล์ตรงกับ checksum และไม่มีลิงก์หรือไฟล์พิเศษอยู่ข้างใน

เมื่อคุณตอบ yes แล้ว `tome` จะเปลี่ยนเจ้าของของโฟลเดอร์ชุดสำรองเป็นผู้ใช้ของตัวอัปเดต คือ `tomecms-updater` เพราะตัวอัปเดตรันด้วยผู้ใช้นั้นและจะอ่านชุดสำรองไม่ได้ถ้าไม่ทำ ชุดสำรองที่คัดลอกเข้ามาด้วย `rsync -a` จะคงเจ้าของเดิมจากเซิร์ฟเวอร์เครื่องเก่าไว้ ซึ่งไม่ใช่ผู้ใช้ของตัวอัปเดตบนเครื่องนี้ ขั้นตอนนี้จึงสำคัญตอนย้ายเว็บ `tome restore` ตั้งเจ้าของให้ไม่ว่าเดิมจะเป็นใคร ไม่มีอะไรนอกโฟลเดอร์นั้นถูกเปลี่ยน

ชุดสำรองที่ตรวจไม่ผ่านจะถูกปฏิเสธด้วยประโยคเดียวและ exit code 1 `tome` ตรวจเท่าที่ตรวจได้ก่อนถามคุณ และตัวอัปเดตตรวจทุกอย่างอีกครั้งในขั้นแรก รวมถึง checksum ทุกไฟล์ ขณะที่เว็บยังเปิดอยู่ นี่คือกรณีที่ปฏิเสธ

| ข้อความ | เพราะอะไร |
| --- | --- |
| `That is not a backup directory under /var/backups/tome-cms.` | ไม่มี path นั้น ไม่ได้อยู่ตรง ๆ ในโฟลเดอร์นั้น หรือชี้ออกไปนอกโฟลเดอร์ |
| `That backup has no manifest.json, so it was cut off or is not a TomeCMS backup.` | ชุดสำรองเขียน manifest เป็นไฟล์สุดท้าย โฟลเดอร์ที่ไม่มีจึงถูกตัดกลางคัน ห้ามกู้คืน |
| `That backup did not pass its checks: its manifest.json does not read as a TomeCMS backup's. Nothing was changed.` | manifest เสียหาย หรือไม่ใช่ของชุดสำรอง TomeCMS |
| `That backup holds a link or a special file (objects/link), so nothing was changed.` | ชุดสำรองที่ TomeCMS สร้างมีแต่ไฟล์และโฟลเดอร์ธรรมดา |
| `That backup is from https://other.example, and this site is https://example.com. A restore keeps the site's address.` | ชุดสำรองสร้างไว้สำหรับโดเมนอื่น |
| `That backup is from TomeCMS 1.14.0, newer than this site's 1.13.0. Update the site to 1.14.0 first: sudo tome update 1.14.0` | เว็บรับข้อมูลจากรุ่นที่ใหม่กว่าไม่ได้ |
| `This site runs TomeCMS 1.12.0. Restore needs 1.13.0 or newer: sudo tome update` | แอปต้องมีขั้นตอนการกู้คืนอยู่ในตัว |
| `The updater is 1.5.0. Restore needs updater 1.6.0: run sudo npm run updater:upgrade from a v1.13.0 checkout.` | หัวข้อ[อัปเกรดตัวอัปเดต](/tome-cms/th/running/updating/#อัปเกรดตัวอัปเดต)แสดงคำสั่งไว้ |
| `An update, a backup, a restore or an image clean-up is running. Wait for it to finish, then try again; sudo tome status shows it.` | รันได้ทีละงานเดียว |
| `Not enough free disk space where backups go (/var/backups/tome-cms): it needs 5.0 GiB. See which old images can go with: sudo tome prune` | ชุดสำรองเพื่อความปลอดภัยในขั้นที่ 3 ต้องใช้ที่ว่างเท่ากับการสำรองข้อมูลทั่วไป |
| `An earlier restore failed and keeps the site in maintenance, so nothing else can run until it is recovered.` | ตามด้วยขั้นตอนออกจากสถานะนั้น ซึ่งหน้า[กลับเข้าหน้าผู้ดูแล](/tome-cms/th/running/recovery/#การกู้คืนที่ทำให้เว็บค้างในโหมดปิดปรับปรุง)อธิบายไว้ |
| `The backup did not pass its checks (a file is missing, or does not match its checksum), so nothing was changed. See what happened with: sudo tome logs updater` | ตัวอัปเดตตรวจทุกไฟล์เองแล้วพบความต่าง |

ถ้าคุณตอบว่าไม่ จะขึ้นว่า `Nothing was done.` และจบด้วย exit code 1

จากนั้นคำสั่งจะติดตามงานไปทีละขั้น เว็บอยู่ในโหมดปิดปรับปรุงตั้งแต่ขั้นที่ 2 จนจบ และใช้เวลานานขึ้นตามปริมาณมีเดียที่เว็บเก็บไว้

1. **Check the backup** ตัวอัปเดตตรวจทุกไฟล์กับ manifest เว็บยังเปิดอยู่
2. **Prepare maintenance** เปิดหน้าปิดปรับปรุงและหยุดแอป
3. **Create the safety backup** สำรองเว็บเต็มชุดตามสภาพตอนนี้ ถ้าขั้นนี้ล้มเหลว ยังไม่มีอะไรถูกแทนที่
4. **Restore the backup** ล้างฐานข้อมูลแล้วใส่ฐานข้อมูลของชุดสำรองกลับเข้าไป ถ้าเป็นชุดสำรองเต็ม จะทำให้ bucket ของมีเดียเหมือนชุดสำรองด้วย คืออัปโหลดทุกไฟล์ที่ชุดสำรองระบุ และลบทุกไฟล์ของ TomeCMS ที่ชุดสำรองไม่ระบุ ไฟล์ที่ TomeCMS ไม่ได้เขียนไว้จะไม่ถูกแตะ
5. **Apply database migrations** ทำเฉพาะเมื่อชุดสำรองมาจากรุ่นที่เก่ากว่า ถ้าไม่ใช่จะข้ามเลขขั้นนี้ไป
6. **Restart TomeCMS** ทุกคนถูกออกจากระบบ คุณจึงต้องเข้าสู่ระบบใหม่ด้วย passkey การเชื่อมต่อ MCP ยังอยู่
7. **Check the restored site** แอปเปิดและพร้อมใช้งานแล้ว ก่อนรีสตาร์ต ตัวอัปเดตได้เทียบจำนวนบทความ เพจ และรายการมีเดียที่กู้คืนกับตัวเลขของชุดสำรองไปแล้ว ถ้าไม่ตรง การกู้คืนถือว่าล้มเหลว

**ถ้าขั้นใดตั้งแต่ขั้นที่ 4 เป็นต้นไปล้มเหลว** ตัวอัปเดตจะใส่ชุดสำรองเพื่อความปลอดภัยกลับเข้าไป แล้วเปิดเว็บตามสภาพเดิม `tome` จะขึ้นว่า `The restore failed, so the safety backup was put back. See what happened with: sudo tome logs updater` และจบด้วย exit code 1 กรณีที่ตัวอัปเดตเองถูกหยุดกลางคัน เช่นเครื่องรีบูต เมื่อมันเริ่มใหม่ การกู้คืนที่ถูกตัดก่อนขั้นที่ 4 ยังไม่ได้แทนที่อะไร ตัวอัปเดตจึงแค่เปิดเว็บ ส่วนที่ถูกตัดตั้งแต่ขั้นที่ 4 เป็นต้นไปจะใส่ชุดสำรองเพื่อความปลอดภัยกลับก่อน ฐานข้อมูลที่ถูกกู้คืนไปครึ่งหนึ่งจะไม่ถูกนำมาให้บริการเลย

ถ้าใส่ชุดสำรองเพื่อความปลอดภัยกลับไม่ได้เหมือนกัน เว็บจะค้างอยู่ในโหมดปิดปรับปรุงและแอปถูกหยุดไว้ เพื่อไม่ให้ใครเขียนลงฐานข้อมูลที่ไม่รู้สภาพ หน้า[กลับเข้าหน้าผู้ดูแล](/tome-cms/th/running/recovery/#การกู้คืนที่ทำให้เว็บค้างในโหมดปิดปรับปรุง)มีขั้นตอนออกจากสภาพนี้

เมื่อสำเร็จ คำสั่งจะแสดงจำนวนที่กู้คืนได้ `Migrations ran.` เมื่อมีการรัน migration และที่อยู่ของชุดสำรองเพื่อความปลอดภัย ตัวอัปเดตไม่ลบชุดสำรองเลย ให้ลบชุดสำรองนั้นเองเมื่อมั่นใจแล้วว่าเว็บที่กู้คืนใช้ได้ ถ้าความลับของปลั๊กอินในชุดสำรองเปิดบนเซิร์ฟเวอร์นี้ไม่ได้ เพราะชุดสำรองมาจากเซิร์ฟเวอร์ที่ใช้ความลับชุดอื่น คำสั่งจะไล่ชื่อให้ทีละรายการ

```text
These plugin settings could not be opened on this server, so enter them again in each plugin:
  turnstile: secretKey
Issue new recovery codes under Security: the ones you have were made on the old server.
```

ถ้าชุดสำรองไม่มีความลับของปลั๊กอินเลย จะขึ้นว่า `If this backup came from another server, issue new recovery codes under Security.` หัวข้อ[รายการตรวจหลังย้าย](/tome-cms/th/running/backups/#หลังย้ายเสร็จ)พาไปดูส่วนที่เหลือ

| อาร์กิวเมนต์หรือตัวเลือก | ทำอะไร |
| --- | --- |
| `backup` | โฟลเดอร์ชุดสำรองที่จะกู้คืน |
| `-y`, `--yes` | ไม่ถามก่อน |

## tome export

เขียนบทความและเพจทุกรายการ พร้อมมีเดียที่ใช้ ลงในไฟล์ Markdown ไฟล์เดียว

```text
$ sudo tome export
Exported to /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz (3.2 MiB).
12 posts, 3 pages and 40 media files.
3 items carry formatting the .md files cannot show (colour, underline or alignment); their .tome.json files keep it.
```

คำสั่งนี้ไม่ถามอะไรและไม่มีตัวเลือก เว็บเปิดอยู่ตลอด เพราะอ่านทุกอย่างในมุมมองเดียวที่สอดคล้องกันของฐานข้อมูล ไฟล์ที่ได้จึงตรงกับช่วงเวลาเดียว ไฟล์อยู่ใน `/var/backups/tome-cms/` เจ้าของคือผู้ใช้ของตัวอัปเดต และเจ้าของอ่านได้คนเดียว (`0600`) ในไฟล์มีบทความและเพจทุกรายการ ทุกภาษา ทุกสถานะ และมีเดียที่ใช้ ส่วนที่ไม่รวมคือการตั้งค่า เมนู สไลด์ การเปลี่ยนเส้นทาง บัญชี สถิติ และไฟล์ที่ไม่มีอะไรใช้ ซึ่งชุดสำรองเต็มเก็บไว้หมด หัวข้อ[สำเนาข้อความของคุณเป็น Markdown](/tome-cms/th/running/backups/#สำเนาข้อความของคุณเป็น-markdown)แสดงว่าข้างในมีอะไร

คำสั่งนี้ปฏิเสธและจบด้วย exit code 1 โดยไม่เขียนอะไรเลย เมื่อเว็บใช้ TomeCMS ก่อน 1.13.0 (`This site runs TomeCMS 1.12.4. Export and import need 1.13.0 or newer: sudo tome update`) เมื่อเว็บอยู่ในโหมดปิดปรับปรุงหรือตัวอัปเดตไม่ว่าง (`The site is in maintenance, or the updater is busy. Try again when it is done.`) และเมื่อที่เก็บชุดสำรองเหลือที่ว่างไม่ถึง 5 GiB (`Not enough free disk space where backups go (/var/backups/tome-cms) for the export: it needs 5.0 GiB, so nothing was exported; sudo tome prune shows old images that can go.`) เพราะไฟล์ถูกเขียนลงที่นั่นสองรอบ คือเป็นไดเรกทอรีทำงานก่อนแล้วจึงแพ็ก บทความที่ใช้ไฟล์ซึ่งหายไปจากที่เก็บจะทำให้หยุดด้วยข้อความ `A media file the content uses (…) is missing from storage, so nothing was exported.` การส่งออกที่ล้มเหลวไม่ทิ้งไฟล์ไว้

## tome import

เพิ่มบทความและเพจในไฟล์เข้าเว็บ รับไฟล์ที่ได้จาก `tome export` หรือโฟลเดอร์ที่จัดวางแบบเดียวกัน เช่นโฟลเดอร์ไฟล์ Markdown ที่คุณเขียนเอง ดูแผนก่อนด้วย `--dry-run`

```sh
sudo tome import /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz --dry-run
```

ถ้าไม่ใส่ `--dry-run` จะแสดงแผนเดียวกัน ถาม แล้วนำเข้า

```text
$ sudo tome import /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz
Archive: /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz
To create: 2 posts in English, 1 post in Thai and 1 page in English.
Skipped, because the address is already taken (nothing is overwritten):
  posts/en/hello.md
Media: 2 files to upload, 1 already on the site.
Categories to create: Baking, Travel.
These translations had an edition skipped, so the rest form a group without it:
  7: posts/en/hello.md
Import these? [y/N] y
Created 2 posts in English, 1 post in Thai and 1 page in English.
Skipped 1, whose address was already taken.
Media: 2 uploaded, 1 reused.
Categories created: Baking, Travel.
```

ถ้าเป็นโฟลเดอร์ บรรทัดแรกจะขึ้นว่า `Directory:` แทน `Archive:`

**ไม่มีอะไรถูกเขียนทับ** รายการที่ address (slug ในภาษานั้น) มีอยู่ในเว็บแล้วจะถูกข้าม และแสดงด้วย path ในไฟล์ ถ้ารันบนเว็บที่ไฟล์นั้นมาจาก ทุกรายการจะถูกข้ามและขึ้นว่า `Nothing to import: everything in it is already on the site.` โดยไม่ถาม

**นำเข้าครบทุกรายการหรือไม่นำเข้าเลย** มีเดียถูกอัปโหลดก่อน แล้วรายการทั้งหมดถูกเขียนในธุรกรรมเดียว ถ้าขั้นนั้นล้มเหลว มีเดียที่อัปโหลดไปแล้วจะถูกลบออกอีกครั้ง

สิ่งที่คำสั่งเก็บไว้และตัดสินใจเอง

- **สถานะและวันที่** `status: published` สร้างรายการที่เผยแพร่แล้วพร้อมวันที่ `published` ฉบับร่างเก็บวันที่ `planned` ไว้ ไฟล์ที่ไม่มี `status` เป็นฉบับร่าง เวลาที่แก้ไขล่าสุดคือเวลาที่นำเข้า
- **เนื้อหา** ถ้ามี `<slug>.tome.json` อยู่ข้างไฟล์ `.md` จะใช้เอกสารตามจริงในนั้น ถ้าไม่มี จะแปลงเนื้อความของ `.md` ด้วยตัวแปลงเดียวกับที่การนำเข้า Markdown ในหน้าแอดมินใช้ ทุกรายการถูกตรวจและทำความสะอาดแบบเดียวกับการบันทึกจากตัวแก้ไข
- **มีเดีย** จับคู่ไฟล์ด้วย checksum ไฟล์ที่เว็บมีอยู่แล้วจึงถูกใช้ซ้ำ ไม่อัปโหลดใหม่ ไฟล์ที่เนื้อหาอ้างถึงแต่ไม่อยู่ในไฟล์นำเข้าจะขึ้นเป็นบรรทัดบอกว่าไฟล์หายไป และตอนจบจะบอกว่ามีกี่ไฟล์
- **หมวดหมู่** จับคู่ด้วยชื่อ โดยไม่สนตัวพิมพ์เล็กใหญ่และไม่มีภาษา ชื่อที่เว็บยังไม่มีจะถูกสร้าง และ `Uncategorized` ก็จับคู่ด้วยชื่อเหมือนชื่ออื่น จึงรวมเข้ากับหมวดหมู่เริ่มต้นของเว็บตราบที่หมวดนั้นยังใช้ชื่อนี้
- **การแปล** รายการที่ใช้ค่า `translation` เดียวกันจะรวมเป็นกลุ่มใหม่หนึ่งกลุ่ม ถ้ามีรายการหนึ่งถูกข้าม รายการที่เหลือก็ยังรวมเป็นกลุ่ม และแผนจะบอก
- **ผู้เขียน** คือเจ้าของเว็บ

**ไฟล์ `.md` ที่เขียนเองไม่มี `.tome.json`** ต้องมีแค่ `title` ใน front matter รูปภาพจะจับคู่ด้วย path แบบ relative ที่ชี้ไปที่ `media/` แต่ลิงก์ relative ที่ชี้ไปยังไฟล์ไม่ถูกจับคู่ ข้อความของลิงก์ยังอยู่ แต่ลิงก์หายไป วางไฟล์ไว้ที่ `posts/en/<slug>.md` หรือ `pages/th/<slug>.md` หัวข้อ[สำเนาข้อความของคุณเป็น Markdown](/tome-cms/th/running/backups/#สำเนาข้อความของคุณเป็น-markdown)แสดงโครงสร้างโฟลเดอร์

ไฟล์หรือโฟลเดอร์ที่จะนำเข้าต้องอยู่ตรง ๆ ใน `/var/backups/tome-cms` `tome` จะปฏิเสธทั้งหมดและไม่นำเข้าอะไรเลย ในกรณีเหล่านี้

| ข้อความ | เพราะอะไร |
| --- | --- |
| `That archive is not under /var/backups/tome-cms.` | อยู่ที่อื่น หรือเป็นลิงก์ที่ชี้ออกไปข้างนอก |
| `That archive holds a path outside itself (…), so nothing was imported.` | มีรายการที่ขึ้นต้นด้วย `/` หรือมีส่วน `..` |
| `That archive holds a link or a special file (…), so nothing was imported.` | มีรายการที่เป็นลิงก์ อุปกรณ์ หรือ pipe |
| `That archive is larger than 2 GiB, or holds more than 20,000 entries.` | ขีดจำกัดของไฟล์ที่นำเข้า |
| `media/big.png is larger than the File Manager accepts for its kind.` | ไฟล์มีเดียแต่ละไฟล์มีขีดจำกัดของคลังไฟล์เอง คือ 8 MiB สำหรับรูปภาพ และ 25 MiB สำหรับเอกสาร |
| `posts/en/a.md has front matter TomeCMS cannot read: published.` | front matter ของไฟล์อ่านไม่ได้ หรือฟิลด์ใดชนิดข้อมูลไม่ถูกต้อง ข้อความจะบอกชื่อไฟล์ และชื่อฟิลด์เมื่อบอกได้ |
| `notes.txt does not fit the archive's layout: manifest.json, media/, and posts/ or pages/ in th/ or en/.` | ไฟล์นั้นไม่มีที่อยู่ในโครงสร้าง |
| `This site runs TomeCMS 1.12.4. Export and import need 1.13.0 or newer: sudo tome update` | แอปต้องมีการนำเข้าอยู่ในตัว |
| `The site is in maintenance, or the updater is busy. Try again when it is done.` | ไม่นำเข้าอะไรขณะที่เว็บอยู่ในโหมดปิดปรับปรุงหรือมีงานอื่นรันอยู่ |
| `Not enough free disk space where backups go (/var/backups/tome-cms) for the import: it needs 5.0 GiB, so nothing was imported; sudo tome prune shows old images that can go.` | การนำเข้าต้องมีที่ว่าง 5 GiB ในที่เก็บชุดสำรอง หรือสองเท่าของขนาดไฟล์ถ้ามากกว่านั้น เพราะไฟล์ถูกแตกออกที่นั่น |

การปฏิเสธที่เกี่ยวกับไฟล์จะตามด้วย `Nothing was imported.` ปัญหาอื่นของไฟล์มีประโยคของตัวเอง เช่น `media/x.exe is not a picture or a document the File Manager accepts.`

`--dry-run` ไม่นำเข้าอะไร แต่โฟลเดอร์ที่ระบุยังถูกเปลี่ยนเจ้าของเป็นผู้ใช้ของตัวอัปเดต เหมือนที่ `restore` ทำกับชุดสำรอง เพื่อให้อ่านแผนได้ ส่วนไฟล์ `.tar.gz` จะถูกแตกลงโฟลเดอร์ทำงานที่ถูกลบทิ้งภายหลัง ตัวไฟล์จึงไม่เปลี่ยน

| อาร์กิวเมนต์หรือตัวเลือก | ทำอะไร |
| --- | --- |
| `archive` | ไฟล์ `.tar.gz` หรือโฟลเดอร์ที่จะนำเข้า |
| `--dry-run` | แสดงแผนและไม่นำเข้าอะไร |
| `-y`, `--yes` | ไม่ถามก่อน |

ถ้าคุณตอบว่าไม่ จะขึ้นว่า `Nothing was done.` และจบด้วย exit code 1

## สร้างธีมและปลั๊กอิน

อีกสามคำสั่งช่วยคุณเขียนธีมหรือปลั๊กอิน คำสั่งเหล่านี้ไม่ได้มีไว้ใช้บนเซิร์ฟเวอร์ แต่รันใน source checkout ของ TomeCMS ด้วย `npm run tome --` ไม่ต้องใช้ `sudo` และถ้ารันที่อื่นจะขึ้นว่า `Run this in a TomeCMS source checkout.` แล้วจบด้วย exit code 1 คำสั่งกลุ่มนี้รันได้จาก `src/cli/main.ts` ของ checkout นั้นเองเท่านั้น `tome` ที่ติดตั้งบนเซิร์ฟเวอร์จึงปฏิเสธเสมอ แม้จะรันในโฟลเดอร์ release ที่ clone ไว้ที่ `/opt/tome-cms-src` ส่วนคำสั่งสำหรับเซิร์ฟเวอร์ข้างต้นยังต้องใช้ `sudo` เหมือนเดิม สองกลุ่มนี้ไม่ปะปนกัน

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
4. การตั้งค่าที่รูปแบบไม่ถูกต้อง เช่น key ซ้ำ ชนิดที่ข้อตกลงไม่อนุญาต label หรือ hint ที่ขาดภาษาอังกฤษหรือภาษาไทย choice ที่ไม่มีตัวเลือกหรือที่ค่า fallback ไม่ใช่หนึ่งในตัวเลือก การตั้งค่า text ของธีมที่ไม่มีความยาวสูงสุด (ข้อตกลงของปลั๊กอินไม่มีความยาวสูงสุดให้ text) และ switch ที่ fallback ไม่ใช่ `on` หรือ `off`
5. ปลั๊กอินที่ `index.ts` ไม่ได้ export เมธอดคู่ sign-in ที่ปลั๊กอินทุกตัวต้องตอบ หรือไม่ได้ export เมธอดของ hook ที่ประกาศไว้อย่างน้อยหนึ่งตัว
6. ธีมที่ import จาก `src/server/` หรือ `src/pages/`
7. สีดิบใน CSS ของธีมที่อยู่นอก token block สีดิบคือค่า hex เช่น `#c00` หรือ `rgb()`, `hsl()`, `hwb()`, `oklch()`, `oklab()`, `lab()`, `lch()` และ `color()` ส่วน token block คือ rule ที่ declaration ของตัวเองเป็น custom property ทั้งหมด เช่น `--color-ink: oklch(24% 0.012 70);` rule ที่ซ้อนอยู่ข้างในจะถูกตรวจแยกต่างหาก ที่อื่นทั้งหมดในสไตล์ชีตให้ใช้ `var(--color-ink)` คำสั่งนี้ไม่อ่านคอมเมนต์ และไม่ตรวจชื่อสีอย่าง `red`

คำสั่งนี้ไม่รันปลั๊กอิน แค่ import manifest แต่ละตัวและ `index.ts` ของปลั๊กอินแต่ละตัวแบบเดียวกับที่ core ทำ โดยไม่เรียกอะไรในนั้นเลย การ export เมธอดแบบไหนก็นับ รวมถึง `export * from './hooks'` แต่เมธอดที่อยู่แค่ในออบเจ็กต์ที่ export default ไม่นับ เพราะ core ใช้ named export ของโมดูล

checkout ที่ไม่มีปัญหา

```text
$ npm run tome -- check
Checked 3 themes and 6 plugins: no problems.
```

ปลั๊กอินที่สร้างด้วย `plugin new nimbus --hook publicPage` แล้วเอา `export` ออกจากบรรทัด `siteNotice` ใน `index.ts` และแทน `settings: [],` ใน `plugin.ts` ด้วยการตั้งค่าที่ไม่มี label ภาษาไทย

```ts
  settings: [
    { key: 'message', kind: 'text', label: { en: 'Message', th: '' }, required: false },
  ],
```

```text
$ npm run tome -- check
src/plugins/nimbus/plugin.ts:11: setting "message" has no Thai label
src/plugins/nimbus/index.ts:1: declares publicPage, but exports none of siteNotice, sitePopup, publicClient
2 problems.
```

`npm run tome -- --help` แสดงรายการคำสั่งเหล่านี้ และทุกคำสั่งรับ `--help`

## เมื่อดิสก์เต็ม

ดิสก์เต็มคือตอนที่ `tome` ช่วยได้มากที่สุด เมื่อที่ว่างตรงที่เก็บชุดสำรองน้อยกว่า 5 GiB การอัปเดต การสำรองข้อมูล การกู้คืน การส่งออก หรือการนำเข้าจะปฏิเสธด้วยข้อความ `Not enough free disk space where backups go` และ `tome status` จะแสดงคำเตือน

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
