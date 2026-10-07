---
title: สถานะและ log
description: ดูภาพรวมของเซิร์ฟเวอร์แบบ managed ด้วย sudo tome status และอ่าน log ล่าสุดของ service ด้วย sudo tome logs
sidebar:
  order: 2
---

สองคำสั่งนี้แสดงว่าเซิร์ฟเวอร์กำลังทำอะไรอยู่ และเหมือนคำสั่งสำหรับเซิร์ฟเวอร์ทุกตัว คือรันด้วย `sudo` และทำตามกติกาในหน้า[คำสั่ง tome](/tome-cms/th/cli/)

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

ใต้บรรทัดดิสก์จะมีคำเตือนเมื่อที่ว่างน้อยกว่า 5 GiB ซึ่งเป็นขั้นต่ำที่การอัปเดตหรือการสำรองข้อมูลต้องใช้ คำเตือนนั้นระบุ `sudo tome prune` ไว้ และถ้าการสำรองข้อมูลค้าง ก็จะมีคำเตือนด้วย ตามหัวข้อ[เมื่อดิสก์เต็ม](/tome-cms/th/cli/updates/#เมื่อดิสก์เต็ม)

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
