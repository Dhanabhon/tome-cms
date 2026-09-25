---
title: นับผู้อ่านจากเว็บแบบ headless
description: ส่งยอดการเปิดอ่านและการอ่านจบจากหน้าเว็บของคุณเอง ให้ไปแสดงในหน้าสถิติของแอดมิน
sidebar:
  order: 2
---

ธีมในตัวนับผู้อ่านให้หน้า **เนื้อหา → สถิติ** ในแอดมินเอง แต่เว็บแบบ headless ต้องส่งยอดเหล่านี้มาเอง โดยส่งไปที่ `/api/v1/stats/hit` ซึ่งเป็น route เดียวใน API ที่เขียนข้อมูลได้

คำขอทั้งหมดมีเท่านี้ ส่งจากเบราว์เซอร์ของผู้อ่านตอนที่บทความเปิดขึ้นมา

```js
fetch('https://cms.example.com/api/v1/stats/hit', {
  body: JSON.stringify({
    event: 'view', kind: 'post', id: post.id, locale: 'th',
    referrer: document.referrer ? new URL(document.referrer).origin : undefined,
    width: innerWidth,
  }),
  headers: { 'Content-Type': 'application/json' },
  keepalive: true,
  method: 'POST',
});
```

ส่วนที่เหลือของหน้านี้อธิบายว่าแต่ละส่วนของคำขอหมายถึงอะไร

## Body

| ฟิลด์ | จำเป็นไหม | ต้องเป็นอะไร |
| --- | --- | --- |
| `event` | จำเป็น | `view` หรือ `read` |
| `kind` | จำเป็น | `home`, `post` หรือ `page` |
| `id` | จำเป็นสำหรับบทความและเพจ | `id` ที่ content API ให้มาสำหรับบทความหรือเพจนั้นในภาษาที่ผู้อ่านกำลังอ่าน ไม่ต้องส่งสำหรับหน้าแรก |
| `locale` | จำเป็น | `th` หรือ `en` ตามภาษาที่ผู้อ่านกำลังอ่าน |
| `referrer` | ไม่จำเป็น | ที่มาของผู้อ่าน ยาวไม่เกิน 2,048 ตัวอักษร ส่งแค่ origin |
| `width` | จำเป็น | ความกว้างของหน้าต่างเป็น CSS pixel เป็นจำนวนเต็มตั้งแต่ 1 ถึง 20,000 |

มีกฎอีกสองข้อที่ผูกฟิลด์เข้าด้วยกัน บทความและเพจต้องมี `id` ส่วนหน้าแรกต้องไม่มี และหน้าแรกส่งได้แค่ `view` เพราะหน้าแรกไม่มีตอนจบให้อ่านถึง

เซิร์ฟเวอร์ยังตรวจด้วยว่า `id` เป็นบทความหรือเพจที่เผยแพร่อยู่ตอนนี้ในภาษาที่ระบุ ถ้าเป็น `id` ของฉบับร่าง หรือของฉบับอีกภาษา คำขอจะถูกทิ้ง

body ทั้งก้อนต้องไม่เกิน 1 KB (1,024 ไบต์) เซิร์ฟเวอร์เก็บแค่ host ของ referrer อยู่แล้ว จึงควรส่ง `new URL(document.referrer).origin` แทนที่อยู่เต็ม เพราะ path ยาว ๆ จากเว็บของคุณเองอาจทำให้ body เกินขนาดได้

## Header

ส่ง `Content-Type: application/json` ถ้าไม่มี header นี้ คำขอจะถูกทิ้ง บนเว็บ headless header นี้ทำให้เบราว์เซอร์ส่ง preflight ก่อน และในโหมด headless route จะตอบ preflight ด้วย `Access-Control-Allow-Origin: *` โดยอนุญาต `POST` และ header `Content-Type`

`keepalive: true` ทำให้คำขอส่งจนเสร็จได้แม้ผู้อ่านออกจากหน้าไปแล้ว เหมือนที่ beacon ทำ ให้ใช้ `fetch` คู่กับ `keepalive` แทน `navigator.sendBeacon` เพราะ `sendBeacon` ส่ง string เป็น `text/plain` และ route จะทิ้งคำขอแบบนั้น

## คำตอบเป็น 204 เสมอ

route ตอบ `204 No Content` ไม่ว่าจะนับ hit นั้นหรือไม่ คนที่พยายามปั่นตัวเลขจึงบอกไม่ได้ว่าคำขอไหนถูกนับ โค้ดของคุณก็บอกไม่ได้เช่นกัน ไม่ต้องรอคำตอบหรือส่งซ้ำ

เมื่อ hit ถูกทิ้ง log ของเซิร์ฟเวอร์จะมีบรรทัด `stats_hit_dropped` พร้อม `reason` ถ้ายอดของเว็บ headless ค้างอยู่ที่ศูนย์ ให้ดูที่ log นี้ก่อน

| `reason` | สาเหตุที่ถูกทิ้ง |
| --- | --- |
| `cross-origin` | เว็บอยู่ในโหมด bundled และคำขอไม่ได้มาจากเว็บของตัวเอง |
| `not-json` | `Content-Type` ไม่ใช่ `application/json` หรือ body ไม่ใช่ JSON |
| `too-large` | body เกิน 1 KB |
| `invalid` | มีฟิลด์ที่ผิดกฎข้างบน |
| `not-installed` | ยังไม่ได้ติดตั้ง TomeCMS |
| `not-live` | `id` ไม่ใช่บทความหรือเพจที่เผยแพร่อยู่ในภาษานั้น |
| `bot` | `User-Agent` ว่าง หรือบอกว่าผู้ส่งเป็น bot หรือ crawler |
| `rate-limited` | มี hit จาก address เดียวมากเกินไป |

## ส่ง view เมื่อไร และส่ง read เมื่อไร

ส่ง `view` หนึ่งครั้งต่อหน้าต่อแท็บของเบราว์เซอร์ การรีโหลดในแท็บเดิมไม่นับเป็น view ใหม่ ส่ง `read` หนึ่งครั้งต่อบทความหรือเพจ เมื่อผู้อ่านเลื่อนถึงท้ายบทความ และแท็บนั้นแสดงอยู่บนจอรวมกันครบ 15 วินาที สำหรับหน้าแรกให้ส่ง `kind: 'home'` โดยไม่มี `id` และส่งแค่ `view`

โค้ดข้างล่างคือวิธีที่ธีมในตัวทำ ตัดเหลือเฉพาะส่วนที่ต้องใช้ `page` คือ `{ kind, id, locale }` ของหน้าที่แสดงอยู่

```js
function send(event, page) {
  fetch('https://cms.example.com/api/v1/stats/hit', {
    body: JSON.stringify({
      event, kind: page.kind, id: page.id, locale: page.locale,
      referrer: document.referrer ? new URL(document.referrer).origin : undefined,
      width: innerWidth,
    }),
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    method: 'POST',
  }).catch(() => {});
}

// True the first time this tab asks about this page and event.
function firstTime(event) {
  const key = `stats:${event}:${location.pathname}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch {
    // No storage: this load counts.
  }
  return true;
}

if (firstTime('view')) send('view', page);

const article = document.querySelector('article');
if (page.kind !== 'home' && article) {
  const end = document.createElement('span');
  end.style.cssText = 'display: block; block-size: 1px;';
  article.append(end);

  let reachedEnd = false;
  let visibleSeconds = 0;
  const clock = setInterval(() => {
    if (document.visibilityState === 'visible') visibleSeconds += 1;
    check();
  }, 1000);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) reachedEnd = true;
    check();
  });
  observer.observe(end);

  function check() {
    if (!reachedEnd || visibleSeconds < 15) return;
    clearInterval(clock);
    observer.disconnect();
    if (firstTime('read')) send('read', page);
  }
}
```

## ใครที่ไม่ควรนับ

อย่าส่งอะไรเลยสำหรับผู้อ่านที่เปิด Do Not Track (`navigator.doNotTrack === '1'`) หรือ Global Privacy Control (`navigator.globalPrivacyControl === true`) ไว้ในเบราว์เซอร์ เซิร์ฟเวอร์ไม่ได้ตรวจสองค่านี้ หน้าเว็บของคุณจึงต้องตรวจเอง

อย่านับเบราว์เซอร์ของคุณเองด้วย ธีมในตัวรู้ว่าเบราว์เซอร์ไหนเป็นของเจ้าของเว็บจากเครื่องหมายที่แอดมินทิ้งไว้ใน `localStorage` ชื่อ `tomecms:stats-owner` แต่เครื่องหมายนี้อยู่ใน origin ของ CMS และเว็บ headless ที่อยู่อีก origin อ่านไม่ได้ ให้ทำสวิตช์ของคุณเอง เช่น flag ใน `localStorage` ของเว็บคุณที่สคริปต์ตรวจก่อนส่งทุกครั้ง

## ขีดจำกัดต่อ address

เซิร์ฟเวอร์นับ hit จาก address เดียวได้ไม่เกิน 120 ครั้งในสิบนาที ที่เกินจากนั้นจะถูกทิ้ง address แบบ IPv6 นับรวมทั้ง /64 ทุก address ในบล็อกเดียวกันจึงใช้ขีดจำกัดร่วมกัน ตัวนับนี้อยู่ในหน่วยความจำของแอปพลิเคชันและเริ่มนับใหม่เมื่อแอปรีสตาร์ต

นี่คือเหตุผลที่ต้องส่ง hit จากเบราว์เซอร์ของผู้อ่าน ถ้าส่งจากเซิร์ฟเวอร์ของเว็บคุณ ผู้อ่านทุกคนจะใช้ address ของเซิร์ฟเวอร์นั้นและขีดจำกัดเดียวกัน และหน้าสถิติจะเห็นผู้อ่านทุกคนอยู่ในประเทศของเซิร์ฟเวอร์

## โหมด bundled

ในโหมด bundled ซึ่งเป็นค่าเริ่มต้น route รับ hit จากเว็บของตัวเองเท่านั้น คือคำขอที่ `Origin` ตรงกับเว็บ หรือคำขอ same-origin ที่ไม่ได้ส่ง `Origin` มา route ตอบโดยไม่มี header CORS เบราว์เซอร์จาก origin อื่นจึงผ่าน preflight ไม่ได้ ตั้ง `TOME_CMS_FRONTEND_MODE=headless` ก่อน ถ้าจะนับจากเว็บของคุณเอง

## เซิร์ฟเวอร์เก็บอะไรไว้

hit หนึ่งครั้งเพิ่มยอดรวมของวันนั้นขึ้นหนึ่ง ไม่มีการตั้ง cookie และไม่มีการเก็บสิ่งที่ระบุตัวผู้อ่านได้ จาก hit แต่ละครั้งเซิร์ฟเวอร์เก็บหน้า ภาษา ว่าเป็น view หรือ read อุปกรณ์ และ host ของ referrer ถ้า `width` น้อยกว่า 768 นับเป็นมือถือ ที่กว้างกว่านั้นนับเป็นเดสก์ท็อป host เก็บเป็นตัวพิมพ์เล็กโดยตัด `www.` ออก และ referrer ที่มาจาก host ของเว็บ headless เอง ซึ่งเซิร์ฟเวอร์อ่านจาก `Origin` ของคำขอ จะนับเป็นภายใน ประเทศได้มาจาก header `CF-IPCountry` ของ CDN หรือจาก address ของผู้อ่าน ซึ่งใช้หาประเทศและนับขีดจำกัดแล้วก็ทิ้งไป

ตัวเลขเหล่านี้เป็นค่าประมาณ คนที่ตั้งใจจริงเพิ่มยอดได้ แต่ไม่เกินขีดจำกัดต่อ address

รูปแบบคำขอฉบับเต็มดูได้ที่ `postStatsHit` ใน[เอกสารอ้างอิง API](/tome-cms/api/reference/) ส่วน route สำหรับอ่านเนื้อหาอยู่ในหน้า[ใช้งาน Headless API](/tome-cms/th/api/overview/)
