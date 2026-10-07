---
title: คำสั่ง tome
description: คำสั่ง tome คืออะไร รันที่ไหน ติดตั้งอย่างไร กติกาที่ทุกคำสั่งทำตาม และรายการคำสั่งทั้งหมด
sidebar:
  label: ภาพรวม
  order: 1
---

`tome` คือคำสั่งบนเซิร์ฟเวอร์แบบ managed คำสั่งยาว ๆ อย่าง `docker compose …` และ `curl --unix-socket …` ถูกซ่อนไว้หลังคำสั่งสั้น ๆ ที่รู้อยู่แล้วว่าทุกอย่างอยู่ตรงไหน ได้แก่ `sudo tome status`, `sudo tome logs`, `sudo tome backup`, `sudo tome update` และ `sudo tome prune` อีกสามคำสั่งใช้ใส่ชุดสำรองกลับเข้าเว็บและย้ายข้อความของคุณ ได้แก่ `sudo tome restore`, `sudo tome export` และ `sudo tome import`

ใน source checkout ของ TomeCMS โปรแกรมตัวเดียวกันมีอีกสามคำสั่งไว้เขียนธีมหรือปลั๊กอิน คำสั่งเหล่านี้รันด้วย `npm run tome --` และไม่ต้องใช้ `sudo` ตามที่หน้า[ธีมและปลั๊กอิน](/tome-cms/th/cli/themes-and-plugins/)อธิบายไว้

ทุกคำสั่งสำหรับเซิร์ฟเวอร์

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

## คำสั่งทั้งหมด

| คำสั่ง | ทำอะไร |
| --- | --- |
| [`sudo tome status`](/tome-cms/th/cli/status-and-logs/#tome-status) | แสดงภาพรวมของเซิร์ฟเวอร์ในหน้าเดียว และไม่เปลี่ยนอะไรเลย |
| [`sudo tome logs`](/tome-cms/th/cli/status-and-logs/#tome-logs) | แสดง log ล่าสุดของ service หนึ่งตัว โดยซ่อนความลับไว้ |
| [`sudo tome backup`](/tome-cms/th/cli/backups/#tome-backup) | ขอให้ตัวอัปเดตสำรองข้อมูล เฉพาะฐานข้อมูล หรือรวมมีเดียด้วยเมื่อใส่ `--full` |
| [`sudo tome restore`](/tome-cms/th/cli/backups/#tome-restore) | ใส่ชุดสำรองกลับเข้าเว็บ |
| [`sudo tome update`](/tome-cms/th/cli/updates/#tome-update) | ติดตั้ง release stable ล่าสุด หรือเวอร์ชันที่คุณระบุ แบบเดียวกับเมนู "ระบบ" |
| [`sudo tome prune`](/tome-cms/th/cli/updates/#tome-prune) | ล้าง image ของ TomeCMS รุ่นเก่า และไฟล์สื่อใน storage ที่ไม่มีอะไรบนเว็บชี้ถึงแล้ว |
| [`sudo tome export`](/tome-cms/th/cli/export-import/#tome-export) | เขียนบทความและเพจทุกรายการ พร้อมมีเดียที่ใช้ ลงในไฟล์ Markdown ไฟล์เดียว |
| [`sudo tome import`](/tome-cms/th/cli/export-import/#tome-import) | เพิ่มบทความและเพจในไฟล์เข้าเว็บ |
| [`npm run tome -- theme new`](/tome-cms/th/cli/themes-and-plugins/) | คัดลอกธีมที่มีอยู่ไปเป็น id ใหม่และลงทะเบียนให้ ใช้ใน source checkout |
| [`npm run tome -- plugin new`](/tome-cms/th/cli/themes-and-plugins/) | เขียนปลั๊กอินที่เสียบกับ hook ของมันแต่ยังไม่ทำอะไร และปิดอยู่ ใช้ใน source checkout |
| [`npm run tome -- check`](/tome-cms/th/cli/themes-and-plugins/) | ตรวจธีมและปลั๊กอินทุกตัว และไม่เปลี่ยนอะไรเลย ใช้ใน source checkout |

ถ้าดิสก์เต็ม ดูวิธีทำให้มีที่ว่างในหัวข้อ[เมื่อดิสก์เต็ม](/tome-cms/th/cli/updates/#เมื่อดิสก์เต็ม)

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
