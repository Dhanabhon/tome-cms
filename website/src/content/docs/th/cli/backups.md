---
title: สำรองและกู้คืนด้วย tome
description: สำรองข้อมูลเซิร์ฟเวอร์แบบ managed ด้วย sudo tome backup และใส่ชุดสำรองกลับเข้าเว็บด้วย sudo tome restore
sidebar:
  label: สำรองและกู้คืนข้อมูล
  order: 3
---

สองคำสั่งนี้ใช้สำรองข้อมูลและใส่ชุดสำรองกลับเข้าเว็บ หน้า[สำรองและกู้คืนข้อมูล](/tome-cms/th/running/backups/)อธิบายเรื่องการสำรองข้อมูลทั้งหมด รวมถึงสำเนาที่คุณเก็บไว้นอกเซิร์ฟเวอร์

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
