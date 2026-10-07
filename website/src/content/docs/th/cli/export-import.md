---
title: ย้ายข้อความของคุณ
description: เขียนบทความและเพจทุกรายการลงไฟล์ Markdown ไฟล์เดียวด้วย sudo tome export และเพิ่มบทความและเพจจากไฟล์นั้นเข้าเว็บด้วย sudo tome import
sidebar:
  order: 5
---

สองคำสั่งนี้ย้ายข้อความของคุณเป็น Markdown จากเว็บหนึ่งไปอีกเว็บ หรือออกจาก TomeCMS หัวข้อ[สำเนาข้อความของคุณเป็น Markdown](/tome-cms/th/running/backups/#สำเนาข้อความของคุณเป็น-markdown)แสดงว่าในไฟล์มีอะไร

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

- **ที่อยู่** `slug` ที่เป็นที่อยู่ที่ถูกต้องอยู่แล้วจะถูกเก็บตามที่เขียนทุกตัวอักษร การย้ายเว็บจึงคงที่อยู่ทุกหน้าไว้ รวมถึงที่อยู่ภาษาไทย ส่วนที่ไม่ถูกต้อง เช่น `Rye & Spelt!` จะถูกแปลงเป็นที่อยู่แบบที่ตัวแก้ไขทำ ถ้าไม่มี `slug` จะใช้ชื่อไฟล์ และใช้ชื่อเรื่องเมื่อชื่อไฟล์ไม่มีคำ
- **สถานะและวันที่** `status: published` สร้างรายการที่เผยแพร่แล้วพร้อมวันที่ `published` ฉบับร่างเก็บวันที่ `planned` ไว้ ไฟล์ที่ไม่มี `status` เป็นฉบับร่าง เวลาที่แก้ไขล่าสุดคือเวลาที่นำเข้า
- **เนื้อหา** ถ้ามี `<slug>.tome.json` อยู่ข้างไฟล์ `.md` จะใช้เอกสารตามจริงในนั้น ถ้าไม่มี จะแปลงเนื้อความของ `.md` ด้วยตัวแปลงเดียวกับที่การนำเข้า Markdown ในหน้าแอดมินใช้ ทุกรายการถูกตรวจและทำความสะอาดแบบเดียวกับการบันทึกจากตัวแก้ไข
- **มีเดีย** จับคู่ไฟล์ด้วย checksum ไฟล์ที่เว็บมีอยู่แล้วจึงถูกใช้ซ้ำ ไม่อัปโหลดใหม่ ไฟล์ที่เนื้อหาอ้างถึงแต่ไม่อยู่ในไฟล์นำเข้าจะขึ้นเป็นบรรทัดบอกว่าไฟล์หายไป และตอนจบจะบอกว่ามีกี่ไฟล์
- **หมวดหมู่** จับคู่ด้วยชื่อ โดยไม่สนตัวพิมพ์เล็กใหญ่และไม่มีภาษา ชื่อที่เว็บยังไม่มีจะถูกสร้าง พร้อมชื่อใน URL และคำอธิบายตามที่ manifest ของไฟล์บอกไว้ ถ้าไฟล์ทำก่อนเวอร์ชัน 1.20.0 หรือชื่อใน URL นั้นมีหมวดอื่นใช้แล้ว ระบบจะสร้างชื่อใน URL จากชื่อหมวดหมู่ให้ หมวดหมู่ที่เว็บมีอยู่แล้วคงค่าเดิมของตัวเองไว้ บทความที่อยู่ในหมวดเริ่มต้นของไฟล์จะเข้าหมวดเริ่มต้นของเว็บ ไม่ว่าไฟล์จะเรียกหมวดนั้นว่า `Uncategorized` หรือตามชื่อใน `defaultCategory` ของ manifest หรือเรียกด้วยชื่อหมวดเริ่มต้นของเว็บเอง หมวดเริ่มต้นของเว็บคงชื่อเดิมของตัวเองไว้ หมวดอื่นในไฟล์ที่ชื่อตรงกับชื่อที่เว็บตั้งให้หมวดเริ่มต้นจึงเข้าหมวดเริ่มต้นด้วยเช่นกัน
- **การแปล** รายการที่ใช้ค่า `translation` เดียวกันจะรวมเป็นกลุ่มใหม่หนึ่งกลุ่ม ถ้ามีรายการหนึ่งถูกข้าม รายการที่เหลือก็ยังรวมเป็นกลุ่ม และแผนจะบอก
- **ผู้เขียน** คือเจ้าของเว็บ

**ไฟล์ `.md` ที่เขียนเองไม่มี `.tome.json`** ต้องมีแค่ `title` ใน front matter รูปภาพจะจับคู่ด้วย path แบบ relative ที่ชี้ไปที่ `media/` แต่ลิงก์ relative ที่ชี้ไปยังไฟล์ไม่ถูกจับคู่ ข้อความของลิงก์ยังอยู่ แต่ลิงก์หายไป วางไฟล์ไว้ที่ `posts/en/<slug>.md` หรือ `pages/th/<slug>.md` หัวข้อ[สำเนาข้อความของคุณเป็น Markdown](/tome-cms/th/running/backups/#สำเนาข้อความของคุณเป็น-markdown)แสดงโครงสร้างโฟลเดอร์

ไฟล์หรือโฟลเดอร์ที่จะนำเข้าต้องอยู่ตรง ๆ ใน `/var/backups/tome-cms` `tome` จะปฏิเสธทั้งหมดและไม่นำเข้าอะไรเลย ในกรณีเหล่านี้

| ข้อความ | เพราะอะไร |
| --- | --- |
| `That archive is not under /var/backups/tome-cms.` | อยู่ที่อื่น หรือเป็นลิงก์ที่ชี้ออกไปข้างนอก |
| `That archive holds a path outside itself (…), so nothing was imported.` | มีรายการที่ขึ้นต้นด้วย `/` หรือมีส่วน `..` |
| `That archive holds a link or a special file (…), so nothing was imported.` | มีรายการที่เป็นลิงก์ อุปกรณ์ หรือ pipe |
| `That archive could not be read as a .tar.gz, so nothing was imported.` | ไฟล์ไม่ใช่ `.tar.gz` หรือเสียหาย |
| `That archive holds an entry its listing does not show (…), so nothing was imported.` | การแตกไฟล์ได้ไฟล์ที่รายการของมันไม่ได้ระบุ แบบที่ไฟล์ซึ่งทำมาเพื่อซ่อนไฟล์ทำ |
| `That archive is larger than 2 GiB, or holds more than 20,000 entries.` | ขีดจำกัดของไฟล์ที่นำเข้า |
| `media/big.png is larger than the File Manager accepts for its kind.` | ไฟล์มีเดียแต่ละไฟล์มีขีดจำกัดของคลังไฟล์เอง คือ 8 MiB สำหรับรูปภาพ และ 25 MiB สำหรับเอกสาร |
| `posts/en/a.md has front matter TomeCMS cannot read: published.` | front matter ของไฟล์อ่านไม่ได้ หรือฟิลด์ใดชนิดข้อมูลไม่ถูกต้อง ข้อความจะบอกชื่อไฟล์ และชื่อฟิลด์เมื่อบอกได้ |
| `notes.txt does not fit the archive's layout: manifest.json, media/, and posts/ or pages/ in th/ or en/.` | ไฟล์นั้นไม่มีที่อยู่ในโครงสร้าง |
| `This site runs TomeCMS 1.12.4. Export and import need 1.13.0 or newer: sudo tome update` | แอปต้องมีการนำเข้าอยู่ในตัว |
| `The site is in maintenance, or the updater is busy. Try again when it is done.` | ไม่นำเข้าอะไรขณะที่เว็บอยู่ในโหมดปิดปรับปรุงหรือมีงานอื่นรันอยู่ |
| `Not enough free disk space where backups go (/var/backups/tome-cms) for the import: it needs 5.0 GiB, so nothing was imported; sudo tome prune shows old images that can go.` | การนำเข้าต้องมีที่ว่าง 5 GiB ในที่เก็บชุดสำรอง หรือสองเท่าของขนาดไฟล์ถ้ามากกว่านั้น เพราะไฟล์ถูกแตกออกที่นั่น |

การปฏิเสธที่เกี่ยวกับไฟล์จะตามด้วย `Nothing was imported.` ปัญหาอื่นของไฟล์มีประโยคของตัวเอง เช่น `media/x.exe is not a picture or a document the File Manager accepts.`

`--dry-run` ไม่นำเข้าอะไร แต่โฟลเดอร์ที่ระบุยังถูกเปลี่ยนเจ้าของเป็นผู้ใช้ของตัวอัปเดต เหมือนที่ `restore` ทำกับชุดสำรอง เพื่อให้อ่านแผนได้ ส่วนไฟล์ `.tar.gz` จะถูกแตกลงโฟลเดอร์ทำงานที่ถูกลบทิ้งภายหลัง ตัวไฟล์จึงไม่เปลี่ยน แผนจะอ่านทุกไฟล์และตรวจโครงสร้าง front matter และขนาด แต่รูปจะถูกถอดรหัสและเนื้อหาของแต่ละรายการจะถูกตรวจแบบที่ตัวแก้ไขตรวจตอนบันทึกก็ต่อเมื่อเขียนจริงเท่านั้น การนำเข้าจึงอาจยังปฏิเสธไฟล์ที่ `--dry-run` ปล่อยผ่าน และเมื่อปฏิเสธ จะไม่มีอะไรถูกนำเข้า

| อาร์กิวเมนต์หรือตัวเลือก | ทำอะไร |
| --- | --- |
| `archive` | ไฟล์ `.tar.gz` หรือโฟลเดอร์ที่จะนำเข้า |
| `--dry-run` | แสดงแผนและไม่นำเข้าอะไร |
| `-y`, `--yes` | ไม่ถามก่อน |

ถ้าคุณตอบว่าไม่ จะขึ้นว่า `Nothing was done.` และจบด้วย exit code 1
