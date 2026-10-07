---
title: ธีมและปลั๊กอิน
description: คำสั่ง tome ของ source checkout ได้แก่ theme new, plugin new และ check ซึ่งรันด้วย npm run tome --
sidebar:
  order: 6
---

คำสั่งสามตัวนี้ช่วยคุณเขียนธีมหรือปลั๊กอิน คำสั่งเหล่านี้ไม่ได้มีไว้ใช้บนเซิร์ฟเวอร์ แต่รันใน source checkout ของ TomeCMS ด้วย `npm run tome --` ไม่ต้องใช้ `sudo` และถ้ารันที่อื่นจะขึ้นว่า `Run this in a TomeCMS source checkout.` แล้วจบด้วย exit code 1 คำสั่งกลุ่มนี้รันได้จาก `src/cli/main.ts` ของ checkout นั้นเองเท่านั้น `tome` ที่ติดตั้งบนเซิร์ฟเวอร์จึงปฏิเสธเสมอ แม้จะรันในโฟลเดอร์ release ที่ clone ไว้ที่ `/opt/tome-cms-src` ส่วนคำสั่งสำหรับเซิร์ฟเวอร์ยังต้องใช้ `sudo` เหมือนเดิม สองกลุ่มนี้ไม่ปะปนกัน

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
8. ฟอนต์ใน `preloadFonts` ของ manifest ธีมที่ไม่ใช่ไฟล์ `.woff2` ใน `public/fonts/`

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
