---
title: เขียนปลั๊กอิน
description: เขียนปลั๊กอินให้เสียบกับ hook ที่แกนของระบบประกาศไว้ บอกรายละเอียดของปลั๊กอินใน manifest ลงทะเบียน และสั่งปิดจากเทอร์มินัลเมื่อจำเป็น
sidebar:
  order: 2
---

ปลั๊กอินเพิ่มความสามารถให้ TomeCMS ผ่าน hook ที่แกนของระบบประกาศไว้ ซึ่งมีอยู่สามตัวเท่านั้น ไม่มี hook ไหนให้รันโค้ดตอนเซิร์ฟเวอร์เริ่มทำงาน เข้าถึงฐานข้อมูล หรือเพิ่ม route เพราะปลั๊กอินที่ทำสิ่งเหล่านั้นได้ก็ทำให้เว็บล่มได้ และเจ้าของเว็บที่เปิดใช้ปลั๊กอินก็ไม่มีทางรู้เลยว่าปลั๊กอินตัวไหนเป็นแบบนั้น

ปลั๊กอินมากับ repository เจ้าของเว็บเปิดใช้และตั้งค่าปลั๊กอินได้ที่หน้า "ปลั๊กอิน" ตามที่หน้า [Cloudflare Turnstile](/tome-cms/th/plugins/turnstile/) อธิบายไว้ และไม่มีทางติดตั้งปลั๊กอินเพิ่มระหว่างที่เว็บทำงานอยู่

ปลั๊กอินหนึ่งตัวคือโฟลเดอร์หนึ่งโฟลเดอร์ใต้ `src/plugins/` และชื่อโฟลเดอร์คือ id ของปลั๊กอิน

| ไฟล์ | เก็บอะไร |
| --- | --- |
| `plugin.ts` | manifest ของปลั๊กอิน |
| `index.ts` | hook ต่าง ๆ ที่ส่งออกทีละชื่อ และ default export ที่มี type เป็น `Plugin` |
| `client.ts` | โค้ดฝั่งเบราว์เซอร์ สำหรับปลั๊กอินที่ต้องรันโค้ดบนหน้าสาธารณะ |

## Hook ทั้งสามตัว

`src/plugins/contract.ts` ประกาศ hook และเมธอดที่ใช้เสียบกับ hook แต่ละตัว แถบบนการ์ดแต่ละใบในหน้า "ปลั๊กอิน" บอกชื่อ hook ด้วยคำของแกนระบบเอง

| Hook | ในหน้า "ปลั๊กอิน" | เมธอด |
| --- | --- | --- |
| `signIn` | "หน้าเข้าสู่ระบบผู้ดูแล" | `signInWidget` และ `verifySignIn` |
| `publicPage` | "ทุกหน้าสาธารณะ" | อย่างน้อยหนึ่งตัวจาก `siteNotice`, `sitePopup` และ `publicClient` |
| `editorSuggestions` | "การเสนอระหว่างเขียน" | อย่างน้อยหนึ่งตัวจาก `categoryLikelihoods`, `pickExcerpt` และ `pickDescription` |

type `Plugin` บังคับให้ทุกปลั๊กอินมี `signInWidget` และ `verifySignIn` ปลั๊กอินที่ไม่ได้ดูแลการเข้าสู่ระบบจะคืน `null` จากตัวแรก และคืน `{ outcome: 'passed' }` จากตัวที่สอง เหมือนที่ lightbox ทำ

ทุกเมธอดได้รับการตั้งค่าของปลั๊กอิน เมธอดของหน้าสาธารณะได้รับหน้าที่กำลังถูกถามด้วย เป็น `PublicPage` ซึ่งมี `kind` เป็น `home`, `page` หรือ `post` และมี `locale` ปลั๊กอินใช้ข้อมูลนี้ตัดสินว่ามีอะไรจะเพิ่มในหน้านั้นไหม ถ้าไม่มีก็คืน `null`

## ปลั๊กอินบอก แกนระบบวาด

ปลั๊กอินคืนค่ามาเป็นข้อมูล แล้วแกนของระบบเป็นผู้ตัดสินว่าจะแสดงอย่างไรและจะเกิดอะไรต่อ สิ่งที่ปลั๊กอินคืนมาจะไม่ถูกเขียนลงในหน้าเป็น HTML

- `signInWidget` คืนชื่อคลาสกับ data attribute ของกล่อง สคริปต์ที่ต้องโหลด และชื่อช่องในฟอร์มที่ widget เขียนคำตอบลงไป แล้วฟอร์มเข้าสู่ระบบเป็นผู้วาดเอง
- `siteNotice` คืนข้อความกับลิงก์ได้ไม่เกินหนึ่งลิงก์ จะใส่สีของแถบเป็น `#rrggbb` และ key ที่ใช้จำว่าผู้อ่านปิดแถบไปแล้วด้วยก็ได้ แกนระบบวาดแถบเอง มีปุ่มปิดเมื่อมี key และทิ้งลิงก์ที่ไม่ได้อยู่บนเว็บนี้และไม่ใช่ `https`
- `sitePopup` คืนหัวข้อ ข้อความ ลิงก์หนึ่งลิงก์ และรูปจากคลังไฟล์ตาม id พร้อมจังหวะที่จะเปิด (`trigger` คือหลัง `delaySeconds` หรือตอนผู้อ่านกำลังจะออกจากหน้า) ภาษาของข้อความ และ key ที่ใช้จำว่าผู้อ่านปิดป๊อปอัปไปแล้ว แกนระบบจะทิ้งป๊อปอัปทั้งอันถ้าหัวข้อหรือข้อความบนลิงก์ว่าง ถ้าลิงก์ไม่ได้อยู่บนเว็บนี้และไม่ใช่ `https` หรือถ้า key ไม่ได้เป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือขีดกลาง ยาว 1 ถึง 80 ตัว และจะวาดรูปก็ต่อเมื่อรูปนั้นยังเป็นรูปที่พร้อมใช้ในคลังของเจ้าของเว็บ
- `verifySignIn` บอกว่าพบอะไร คือ `passed`, `refused` หรือ `unavailable` พร้อม `detail` สำหรับ log แกนระบบเป็นผู้ตัดสินว่าจะเกิดอะไรต่อ ถ้าเป็น `refused` การเข้าสู่ระบบครั้งนั้นถูกปฏิเสธ ถ้าเป็น `unavailable` คือถามบริการภายนอกไม่ได้ ระบบจะบันทึก log แล้วไปตรวจ passkey ต่อ ปลั๊กอินที่ throw error ก็นับเป็น `unavailable` เช่นกัน ปลั๊กอินที่พัง หรือบริการภายนอกที่ล่ม จึงไม่ล็อกเจ้าของเว็บออกจากระบบ
- `categoryLikelihoods` คืนโอกาสที่บทความจะอยู่ในแต่ละหมวดหมู่ โดยใช้ id ของหมวดหมู่ ส่วน `pickExcerpt` กับ `pickDescription` เลือกข้อความหนึ่งท่อนจากที่แกนระบบเสนอให้ แกนระบบตัดสินเองว่าโอกาสแบบไหนจะกลายเป็นคำแนะนำ เก็บข้อความที่เลือกไว้ก็ต่อเมื่อเป็นท่อนที่เสนอให้จริง และถือว่า `null` คือ "ไม่ได้ตอบ"

แกนระบบเป็นผู้วาดแถบและป๊อปอัป และยังเป็นผู้ปิดแถบที่มี key พร้อมจำไว้ว่าผู้อ่านปิดไปแล้ว ปลั๊กอินที่คืน `siteNotice` จึงไม่ต้องมีโค้ดฝั่งเบราว์เซอร์ของตัวเอง ส่วนโค้ดที่เปิดป๊อปอัปไม่ได้อยู่ในแกนระบบ โค้ดนี้อยู่ใน `src/plugins/popup/client.ts` และโหลดผ่าน `publicClient` ของปลั๊กอินป๊อปอัปเท่านั้น ปลั๊กอินที่คุณเขียนเองซึ่งคืน `sitePopup` จึงต้องคืน `publicClient` สำหรับหน้าเดียวกันด้วย และมี `client.ts` ที่เปิดป๊อปอัป ถ้าไม่มี ป๊อปอัปจะถูกวาดไว้แต่ไม่เคยเปิดขึ้นมา

แกนระบบยังจำกัดจำนวนปลั๊กอินที่ทำงานพร้อมกันด้วย หน้าเข้าสู่ระบบมีปลั๊กอินดูแลได้ตัวเดียว และหน้าหนึ่งมีแถบได้แถบเดียวกับป๊อปอัปได้อันเดียว ถ้าเปิดไว้หลายตัว ตัวแรกตามลำดับใน registry ที่ตอบกลับมาจะเป็นตัวที่ถูกใช้

`publicClient` เป็น hook เดียวที่รันโค้ดของปลั๊กอินเองในเบราว์เซอร์ของผู้อ่านทุกคน เมธอดนี้คืน `null` หรือคืน object ที่มี `dataset` ซึ่งจะไปถึงเบราว์เซอร์เป็น attribute `data-*` บนจุดเกาะที่ซ่อนไว้ จากนั้นแกนระบบจะโหลด `src/plugins/<id>/client.ts` ด้วย dynamic import แล้วเรียก default export ของไฟล์นั้นโดยส่งจุดเกาะให้ ปลั๊กอินที่ปิดอยู่ หรือคืน `null` สำหรับหน้านั้น จะไม่ส่งอะไรไปให้ผู้อ่านเลย ที่ยอมให้ทำได้ขนาดนี้ก็เพราะปลั๊กอินมากับ repository และถูกรีวิวใน commit เดียวกับโค้ดส่วนอื่น

ปลั๊กอินไม่มีสไตล์ชีตของตัวเอง กฎ CSS ของสิ่งที่โค้ดฝั่งเบราว์เซอร์วาดขึ้นมาอยู่ใน `src/styles/global.css` ของแกนระบบ เขียนด้วย design token และเป็นที่เดียวกับที่กฎของ lightbox อยู่

## การตั้งค่า

ปลั๊กอินเขียนรายการการตั้งค่าไว้ใน manifest แกนของระบบจะวาดช่องให้ทุกรายการใต้ "ตั้งค่า" ตรวจการบันทึกทุกครั้งตามรายการนี้ แล้วส่งค่าที่เก็บไว้ให้ปลั๊กอินเป็น `PluginSettings` ซึ่งเป็น record ของข้อความ

| ชนิด | บันทึกอะไรได้ |
| --- | --- |
| `text` | ข้อความอะไรก็ได้ ตัดช่องว่างหัวท้ายออก |
| `secret` | ข้อความที่ถูกเข้ารหัสด้วย `TOME_CMS_CONTEXT_SECRET` ก่อนเก็บ และไม่เคยถูกส่งกลับไปที่เบราว์เซอร์ หน้าจอรู้แค่ว่ามีค่าเก็บไว้หรือไม่ และถ้าเว้นช่องว่างไว้ ค่าเดิมจะยังอยู่ |
| `switch` | `on` หรือ `off` |
| `color` | สีในรูป `#rrggbb` ซึ่งเป็นรูปแบบเดียวที่ปลอดภัยพอจะใส่ใน style attribute ของทุกหน้าสาธารณะ |
| `choice` | ค่าหนึ่งใน `options` ของการตั้งค่านั้น |
| `image` | id ของรูปที่พร้อมใช้ในคลังไฟล์ของเจ้าของเว็บ และคลังไฟล์จะไม่ยอมลบรูปนั้นอีก |

การตั้งค่าแต่ละรายการยังมี `key`, `label` และ `hint` ที่ไม่ใส่ก็ได้ โดย `label` กับ `hint` เขียนเป็น `{ en, th }` ถ้าตั้ง `required: true` ปลั๊กอินจะขึ้นว่า "ยังไม่ได้ตั้งค่า" และเปิดใช้ไม่ได้ตราบที่ช่องนั้นยังว่าง `fallback` คือค่าที่ใช้เมื่อยังไม่มีใครกรอก ควรใส่ให้สวิตช์และสีทุกช่อง ส่วน `fallback` ของ `choice` ต้องเป็นค่าหนึ่งใน `options` และมีแค่ `choice` ที่ใส่ `options` ได้

การบันทึกที่ไม่ได้ส่งการตั้งค่าไหนมา จะเก็บค่าเดิมของรายการนั้นไว้ สวิตช์บนการ์ดจึงเปิดปิดปลั๊กอินได้โดยไม่ต้องส่งช่องอื่นมาด้วย ค่า secret ที่ถอดรหัสไม่ได้เพราะ `TOME_CMS_CONTEXT_SECRET` เปลี่ยนไป ปลั๊กอินจะเห็นเหมือนไม่มีค่านั้น และไม่ได้รับข้อความที่ยังเข้ารหัสอยู่

## Manifest ของปลั๊กอิน

`plugin.ts` ส่งออก manifest แยกไว้จาก hook เพื่อให้แอดมินวาดการ์ดของปลั๊กอินได้โดยไม่ต้องโหลดตัวปลั๊กอิน

| ช่อง | คืออะไร |
| --- | --- |
| `id` | ชื่อโฟลเดอร์ และเป็น id ที่ `npm run plugin:disable` รับ |
| `name` | ชื่อบนการ์ด ใช้คำเดียวกันทั้งสองภาษา |
| `description` | ประโยคเดียวสำหรับการ์ด เขียนเป็น `{ en, th }` |
| `hooks` | hook ที่ปลั๊กอินเสียบ จากสามตัวข้างบน |
| `icon` | ไอคอนหนึ่งตัวจากไอคอนของแอดมินเอง ตามชื่อใน `src/lib/icons.ts` |
| `brand` | โลโก้ของบริการที่ปลั๊กอินติดต่อ ตามชื่อใน `src/lib/brand-marks.ts` แสดงแทนไอคอน ไม่ใส่ก็ได้ |
| `previewHref` | ที่อยู่บนเว็บสาธารณะที่แสดงปลั๊กอินให้เห็นทันที ระหว่างที่ปลั๊กอินเปิดอยู่ แผง "ตั้งค่า" จะมี "ดูตัวอย่างบนเว็บ" ไม่ใส่ก็ได้ |
| `settings` | การตั้งค่าข้างบน เรียงตามลำดับที่ฟอร์มแสดง |

การ์ดวาดได้แค่ไอคอนและโลโก้ที่แกนระบบมี และใช้คำของแกนระบบบอก hook แต่ละตัว `tests/unit/plugin-admin.test.ts` ตรวจทุกปลั๊กอินเทียบกับ manifest ของตัวเอง hook ที่ระบุไว้ต้องมีเมธอดรองรับจริง และไอคอนต้องมีอยู่จริง

## ปลั๊กอินหนึ่งตัวตั้งแต่ต้นจนจบ

ปลั๊กอินตัวอย่างนี้วางปุ่ม "กลับขึ้นบนสุด" ไว้ในหน้าบทความ หรือในทุกหน้า manifest ของมันมีการตั้งค่าเดียวซึ่งเป็นตัวเลือก

```ts
import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: {
    en: 'A button that takes the reader back to the top of a long page.',
    th: 'ปุ่มที่พาผู้อ่านกลับขึ้นไปบนสุดของหน้ายาว ๆ',
  },
  hooks: ['publicPage'],
  icon: 'up',
  id: 'totop',
  name: 'Back to top',
  settings: [
    {
      fallback: 'post',
      key: 'where',
      kind: 'choice',
      label: { en: 'Where', th: 'แสดงที่' },
      options: [
        { label: { en: 'Posts', th: 'บทความ' }, value: 'post' },
        { label: { en: 'Every page', th: 'ทุกหน้า' }, value: 'all' },
      ],
      required: false,
    },
  ],
};
```

`index.ts` เสียบกับ hook และตอบเมธอดของการเข้าสู่ระบบทั้งสองว่าไม่มีอะไรจะเพิ่ม

```ts
import type { Plugin, PluginSettings, PublicPage, SignInVerdict, SignInWidget } from '../contract';

export { manifest } from './plugin';

/** Nothing to add to the sign-in: this plugin is about the page a reader sees. */
export function signInWidget(): SignInWidget | null {
  return null;
}

export async function verifySignIn(): Promise<SignInVerdict> {
  return { outcome: 'passed', detail: 'back to top does not guard anything' };
}

export function publicClient(settings: PluginSettings, page: PublicPage) {
  if (settings.where !== 'all' && page.kind !== 'post') return null;
  return { dataset: { label: page.locale === 'th' ? 'กลับขึ้นบนสุด' : 'Back to top' } };
}

const plugin: Plugin = { publicClient, signInWidget, verifySignIn };
export default plugin;
```

`client.ts` ทำงานในเบราว์เซอร์ของผู้อ่าน และอ่านข้อความบนปุ่มจากจุดเกาะ

```ts
export default function wireBackToTop(mount: HTMLElement): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'back-to-top';
  button.textContent = mount.dataset.label ?? 'Back to top';
  button.addEventListener('click', () => window.scrollTo({ top: 0 }));
  mount.replaceWith(button);
}
```

กฎ CSS ของ `.back-to-top` ใส่ไว้ใน `src/styles/global.css` ส่วน `src/plugins/lightbox/` เป็นปลั๊กอินตัวเล็กที่สุดที่มากับ TomeCMS และเขียนด้วยวิธีเดียวกัน

## ลงทะเบียนปลั๊กอิน

1. เพิ่ม id ลงใน `PLUGINS` ใน `src/plugins/registry.ts` แบบ dynamic import

   ```ts
   const PLUGINS = {
     lightbox: () => import('./lightbox'),
     notice: () => import('./notice'),
     popup: () => import('./popup'),
     totop: () => import('./totop'),
     turnstile: () => import('./turnstile'),
     typesafe: () => import('./typesafe'),
   } as const;
   ```

2. เพิ่ม manifest ลงใน `PLUGIN_MANIFESTS` ใน `src/plugins/manifests.ts`

   ```ts
   import { manifest as totop } from './totop/plugin';

   export const PLUGIN_MANIFESTS: readonly PluginManifest[] = [turnstile, notice, popup, lightbox, typesafe, totop];
   ```

3. รัน `npm run check` และ `npm run test:unit`

`client.ts` ไม่ต้องลงทะเบียนที่ไหน แกนระบบหาไฟล์นี้เองจาก id ของปลั๊กอิน ลำดับใน `PLUGINS` คือลำดับที่ปลั๊กอินถูกถาม ส่วนลำดับใน `PLUGIN_MANIFESTS` คือลำดับของการ์ดในหน้า "ปลั๊กอิน"

registry ยังเป็นตัวที่บังคับให้ปลั๊กอินทำตามข้อตกลงด้วย เพราะ registry คืนแต่ละโมดูลเป็น `Plugin` โมดูลที่ส่งออกไม่ตรงกับข้อตกลงจึงทำให้ `npm run check` ล้ม

## สั่งปิดปลั๊กอินจากเทอร์มินัล

ปิดปลั๊กอินได้จากเทอร์มินัลในโฟลเดอร์โค้ด ซึ่งคำสั่งจะอ่านค่าจาก `.env.local`

```sh
npm run plugin:disable totop
npm run plugin:disable totop -- --forget
```

คำสั่งแรกปิดปลั๊กอินแต่ยังเก็บการตั้งค่าไว้ แล้วพิมพ์ `totop is off.` คำสั่งที่สองล้างการตั้งค่าไปด้วย ซึ่งหน้าแอดมินทำไม่ได้ เพราะในหน้าแอดมิน ช่องที่เว้นว่างหมายถึงให้เก็บค่าเดิมไว้ ปลั๊กอินที่ไม่เคยถูกบันทึกบนเว็บนี้จะได้ข้อความ `totop was not switched on.` ส่วน id ที่ไม่ได้ติดตั้งไว้จะได้บรรทัดวิธีใช้พร้อมรายชื่อ id ที่ติดตั้งอยู่

นี่คือทางกลับเข้าหน้าแอดมินเมื่อปลั๊กอินขวางอยู่ เช่น challenge หน้าเข้าสู่ระบบที่โหลดไม่ขึ้น หน้า[กลับเข้าหน้าผู้ดูแล](/tome-cms/th/running/recovery/)มีขั้นตอนสำหรับ Turnstile
