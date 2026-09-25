---
title: ใช้งาน Headless API
description: อ่านบทความ เพจ และข้อมูลเว็บไซต์ที่เผยแพร่แล้วผ่าน HTTP จากเว็บอื่นหรือแอป
sidebar:
  order: 1
---

TomeCMS ตอบ HTTP request สำหรับเนื้อหาที่เผยแพร่แล้วโดยไม่ต้องเข้าสู่ระบบ เว็บที่สร้างด้วยเฟรมเวิร์กอื่นหรือแอปมือถือจึงอ่านบทความและเพจชุดเดียวกับที่ธีมในตัวแสดงอยู่ได้ API นี้อ่านได้อย่างเดียว และส่งกลับเฉพาะเนื้อหาที่เผยแพร่แล้ว ฉบับร่างหรือบทความที่ตั้งเวลาไว้จะยังไม่อยู่ในนี้จนกว่าจะถึงเวลาเผยแพร่

API ใช้ได้ทั้งโหมด bundled และโหมด headless ในโหมด headless (`TOME_CMS_FRONTEND_MODE=headless`) TomeCMS จะไม่แสดงหน้าเว็บสาธารณะเอง เว็บที่คุณสร้างจะดึงเนื้อหาจาก API นี้ไปแสดงให้ผู้อ่านแทน

TomeCMS ยังไม่ถึงเวอร์ชัน 1.0.0 ถึง route จะมีเลขเวอร์ชันอยู่ใน path แต่ยังไม่มีรุ่น 0.x ไหนรับประกันว่าจะไม่เปลี่ยน route เหล่านี้ หลังอัปเกรดทุกครั้งให้ตรวจ `openapi.json` ของระบบคุณอีกรอบ

## Route ทั้งหมด

ทุก route ตอบ `GET` และตอบ `OPTIONS` สำหรับ preflight ของเบราว์เซอร์

| Route | สิ่งที่ส่งกลับ |
| --- | --- |
| `/api/v1/content/site` | ชื่อเว็บ คำโปรย คำอธิบาย ภาษา เขตเวลา ผู้เขียน และรูปแบรนด์ |
| `/api/v1/content/posts?locale=th` | บทความที่เผยแพร่แล้วในภาษาเดียว เรียงจากใหม่ไปเก่า แบ่งเป็นชุด |
| `/api/v1/content/posts/{slug}?locale=th` | บทความที่เผยแพร่แล้วหนึ่งบทความ |
| `/api/v1/content/pages?locale=th` | เพจที่เผยแพร่แล้วในภาษาเดียว เรียงจากใหม่ไปเก่า แบ่งเป็นชุด |
| `/api/v1/content/pages/{slug}?locale=th` | เพจที่เผยแพร่แล้วหนึ่งเพจ |
| `/api/v1/content/categories?locale=th` | หมวดหมู่ที่บทความซึ่งเผยแพร่แล้วใช้อยู่ |
| `/api/v1/content/navigation?locale=th` | เมนูส่วนหัวและส่วนท้าย |
| `/api/v1/content/slides?locale=th` | สไลด์หน้าแรกที่แสดงอยู่ตอนนี้ ตามลำดับ ไม่เกินห้าสไลด์ |
| `/api/v1/content/openapi.json` | เอกสาร OpenAPI 3.1 ที่อธิบายทุก route ข้างบน |

route ที่ส่งเนื้อหาจะวางข้อมูลไว้ใต้ `data` รายการบทความและรายการเพจมี `meta` กับ `links` เพิ่มมา ส่วนหมวดหมู่ เมนู และสไลด์มี `meta` ที่บอกภาษา บทความหรือเพจหนึ่งชิ้นมี HTML อยู่ใน `contentHtml` และเอกสารต้นฉบับของ editor อยู่ใน `contentJson` ฟิลด์ทั้งหมดดูได้ใน[เอกสารอ้างอิง API](/tome-cms/api/reference/)

slug อาจเป็นภาษาไทย เพราะบทความที่ตั้งชื่อเป็นภาษาไทยจะได้ที่อยู่เป็นภาษาไทย จึงต้อง encode ก่อนนำไปต่อเป็น path

```js
const url = `https://cms.example.com/api/v1/content/posts/${encodeURIComponent(slug)}?locale=th`;
const { data: post } = await (await fetch(url)).json();
```

## พารามิเตอร์ locale

`locale` มีค่าเป็น `th` หรือ `en` ทุก route ที่เนื้อหาแยกตามภาษาต้องส่งค่านี้ ได้แก่ posts, pages, categories, navigation และ slides ถ้าไม่ส่งจะได้ `400`

บทความหรือเพจฉบับภาษาไทยกับฉบับภาษาอังกฤษเป็นสองชิ้นแยกกัน แต่ละชิ้นมี slug ของตัวเอง ทั้งคู่ใช้ `translationGroupId` เดียวกัน และแต่ละชิ้นบอกฉบับที่เผยแพร่อยู่ทั้งหมดไว้ใน `translations`

route ทุกตัวเข้มงวดเรื่องพารามิเตอร์ ถ้าส่งพารามิเตอร์ที่ route ไม่รู้จักจะได้ `400` พิมพ์ชื่อผิดจึงรู้ทันที ไม่ถูกปล่อยผ่านไปเงียบ ๆ ส่วน `/site` กับ `/openapi.json` ไม่รับพารามิเตอร์ใดเลย

## แบ่งผลลัพธ์เป็นชุดด้วย cursor

รายการบทความและเพจส่งมาทีละชุด เรียงจากใหม่ไปเก่า `limit` กำหนดจำนวนต่อชุดได้ตั้งแต่ 1 ถึง 50 ถ้าไม่ส่งจะเป็น 20 ส่วน `category` ใช้กรองบทความให้เหลือหมวดเดียว โดยเทียบจากชื่อหมวดและไม่สนตัวพิมพ์เล็กพิมพ์ใหญ่

ถ้ายังมีชุดถัดไป `meta.hasMore` จะเป็น `true` และ `links.next` คือที่อยู่ของชุดนั้น พอถึงชุดสุดท้าย `links.next` จะเป็น `null`

```sh
curl -s 'https://cms.example.com/api/v1/content/posts?locale=th&limit=2' | jq '{meta, links}'
```

```json
{
  "meta": {
    "locale": "th",
    "limit": 2,
    "hasMore": true
  },
  "links": {
    "next": "https://cms.example.com/api/v1/content/posts?locale=th&limit=2&cursor=eyJ2IjoxLCJyZXNvdXJjZSI6InBvc3RzIi..."
  }
}
```

เรียก `links.next` ตามที่ได้มาได้เลย ในนั้นมี `locale` `limit` และ `category` เดิมของคุณ พร้อม `cursor` ที่เพิ่มเข้ามา ลูปนี้พิมพ์ slug ของบทความภาษาอังกฤษทุกบทความ

```sh
url='https://cms.example.com/api/v1/content/posts?locale=en&limit=50'
while [ "$url" != null ]; do
  body=$(curl -s "$url")
  echo "$body" | jq -r '.data[].slug'
  url=$(echo "$body" | jq -r '.links.next')
done
```

เซิร์ฟเวอร์เซ็น cursor ทุกตัว และ cursor แต่ละตัวใช้ได้กับ query ชุดเดิมที่ได้ cursor นั้นมาเท่านั้น ถ้าใช้ cursor เดิมแต่เปลี่ยน `limit` หรือ `category` หรือแก้ cursor เอง จะได้ `400` พร้อมข้อความ `Invalid pagination cursor.` ลายเซ็นนี้ใช้ `TOME_CMS_CONTEXT_SECRET` ถ้าเปลี่ยนค่านี้ cursor ทุกตัวที่ออกไปก่อนหน้าจะใช้ไม่ได้อีก

## แคช

คำตอบที่สำเร็จทุกครั้งมี header `ETag` และ `Last-Modified` พร้อม `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300` เบราว์เซอร์หรือ CDN จึงเก็บคำตอบไว้ได้หนึ่งนาที ส่วน `/openapi.json` เก็บได้หนึ่งวัน

ส่ง `ETag` กลับมาใน `If-None-Match` หรือส่งเวลาจาก `Last-Modified` มาใน `If-Modified-Since` ถ้าไม่มีอะไรเปลี่ยน จะได้ `304 Not Modified` แบบไม่มี body ถ้าส่งมาทั้งสองตัว เซิร์ฟเวอร์จะตัดสินจาก `If-None-Match`

```sh
etag=$(curl -si 'https://cms.example.com/api/v1/content/site' | awk -F': ' 'tolower($1) == "etag" { print $2 }' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $etag" 'https://cms.example.com/api/v1/content/site'
# 304
```

`ETag` คือ hash ของ body จึงเปลี่ยนทุกครั้งที่คำตอบเปลี่ยน ส่วนคำตอบที่เป็น error ส่งมาพร้อม `Cache-Control: no-store` และไม่ถูกแคช

## CORS

คำตอบสาธารณะทุกครั้ง รวมถึง error มี `Access-Control-Allow-Origin: *` หน้าเว็บจาก origin ไหนก็เรียก API จากเบราว์เซอร์ได้ preflight อนุญาต `GET` และ `OPTIONS` พร้อม header `If-None-Match` และ `If-Modified-Since` และเบราว์เซอร์จำผล preflight ไว้ได้หนึ่งวัน

API นี้ไม่มีการยืนยันตัวตน อย่าส่ง credentials ไปกับคำขอ เพราะถ้าเรียกด้วย `credentials: 'include'` เบราว์เซอร์จะไม่รับคำตอบที่เป็น wildcard

## เมื่อเกิด error

error ส่งกลับมาเป็น `application/problem+json` มีฟิลด์ `type` `title` `status` `detail` `instance` (path ที่ขอมา) และ `requestId`

| Status | เกิดเมื่อ |
| --- | --- |
| `400` | ขาดพารามิเตอร์ ส่งพารามิเตอร์ที่ไม่รู้จักหรือค่าเกินขอบเขต หรือ cursor ไม่ถูกต้อง |
| `404` | ไม่มีบทความหรือเพจที่เผยแพร่แล้วซึ่งใช้ slug นี้ในภาษานี้ |
| `500` | ทำคำขอให้เสร็จไม่ได้ |
| `503` | เว็บยังไม่พร้อม หรือกำลังปิดปรับปรุง |

คำตอบทุกครั้งมี header `X-Request-ID` และ log ของเซิร์ฟเวอร์บันทึก ID เดียวกันไว้ แนบ ID นี้มาด้วยเมื่อรายงานปัญหา

ทั้งหมดนี้ใช้เมื่อติดตั้ง TomeCMS แล้ว ก่อนติดตั้ง ทุก route จะตอบ `503` เป็น JSON ธรรมดาที่มี `setupUrl` ชี้ไปที่ `/install` โดยไม่มี `X-Request-ID` และไม่มี header CORS

## เมื่อเว็บปิดปรับปรุง

ระหว่างที่เจ้าของเว็บเปิดโหมดปิดปรับปรุง route เนื้อหาจะตอบ `503` และ error จะมีฟิลด์ `maintenance` เพิ่มมา ซึ่งเป็นข้อความที่เจ้าของเขียนไว้ให้ผู้เยี่ยมชม

```json
{
  "detail": "The site is closed for maintenance.",
  "instance": "/api/v1/content/posts",
  "maintenance": {
    "backAt": "2026-10-01T09:00:00.000Z",
    "heading": "Back on Thursday",
    "locale": "en",
    "message": "We are moving to a new server."
  },
  "requestId": "0b7c6a52-3f1e-4d2a-9a55-2f4c1d8e9b10",
  "status": 503,
  "title": "Service Unavailable",
  "type": "about:blank"
}
```

ข้อความจะเป็นภาษาตาม `locale` ของคำขอ ถ้าคำขอไม่ได้ระบุ จะใช้ภาษาหลักของเว็บ ถ้าเจ้าของไม่ได้เขียนอะไรไว้ จะเป็นข้อความตั้งต้นของ TomeCMS `backAt` เป็น `null` เว้นแต่เจ้าของตั้งเวลากลับมาไว้ และระหว่างที่ยังไม่ถึงเวลานั้น คำตอบจะมี header `Retry-After` ด้วย ให้แสดงหัวข้อและข้อความนี้แทนหน้าเว็บของคุณจนกว่า API จะกลับมาตอบตามปกติ

`/openapi.json` และ draft preview ยังเปิดอยู่ ส่วน preflight ก็ยังตอบตามปกติ เบราว์เซอร์จาก origin อื่นจึงยังอ่าน `503` นี้ได้

## Draft preview

route สาธารณะไม่ส่งฉบับร่างออกมาเลย ถ้าเจ้าของอยากดูฉบับร่างบนเว็บ headless ก่อนเผยแพร่ TomeCMS มี preview token ให้ใช้

`POST /api/admin/previews` พร้อม body JSON อย่าง `{"contentType": "post", "contentId": "<the post's id>"}` จะออก token ให้หนึ่งตัว คำขอนี้ต้องมี session ของเจ้าของ และต้องมาจาก origin ของ CMS เอง ในแอดมินไม่มีปุ่มที่เรียก route นี้ คำตอบคือ `201` พร้อม `{"url": "/api/v1/content/preview/<token>"}` และเมื่อ `GET` ที่อยู่นั้นจะได้ฉบับร่างอยู่ใน `data.content` ในรูปแบบเดียวกับบทความหรือเพจที่เผยแพร่แล้ว และมี `data.contentType` อยู่ข้างกัน

token มีอายุ 30 นาที การออก token ใหม่ให้บทความหรือเพจเดิมจะยกเลิก token ตัวก่อนหน้า ส่วน token ที่ไม่รู้จัก หมดอายุ หรือถูกยกเลิกแล้วจะได้ `404`

คำตอบของ preview มี `Cache-Control: private, no-store` และ `Referrer-Policy: no-referrer` แต่ไม่มี header CORS เลย จึงไม่ถูกแคชไว้ที่ไหน และเบราว์เซอร์จาก origin อื่นอ่านไม่ได้ ให้ดึง preview จากเซิร์ฟเวอร์ของเว็บคุณ ไม่ใช่จากเบราว์เซอร์ของผู้อ่าน route ของ preview ไม่อยู่ในเอกสาร OpenAPI เพราะเอกสารนั้นอธิบายเฉพาะส่วนที่เป็นสาธารณะ

## สัญญาของ API (contract)

`/api/v1/content/openapi.json` คือสัญญาของ API เป็นเอกสาร OpenAPI 3.1 ที่บอกทุก route สาธารณะ พร้อมพารามิเตอร์และคำตอบของแต่ละ route เอกสารนี้สร้างจากโค้ดชุดเดียวกับที่ตอบคำขอ จึงอธิบายระบบที่ส่งเอกสารนั้นออกมา ใช้สร้าง client แบบมี type หรือเปิดอ่านเพื่อดูว่าเวอร์ชันของคุณรองรับอะไรบ้าง

[เอกสารอ้างอิง API](/tome-cms/api/reference/) ในเว็บนี้สร้างจากเอกสารเดียวกันใน repository และคำอธิบาย schema ในนั้นเป็นภาษาอังกฤษ

route เดียวที่เขียนข้อมูลได้มีหน้าของตัวเอง ดูที่[นับผู้อ่านจากเว็บแบบ headless](/tome-cms/th/api/counting-readers/)
