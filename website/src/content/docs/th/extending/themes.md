---
title: เขียนธีม
description: สร้างธีมของหน้าเว็บสาธารณะตามข้อตกลงของธีม ให้ธีมมีการตั้งค่าที่แอดมินเสนอให้เลือกได้ ลงทะเบียนธีม และตรวจว่าสไตล์ชีตเปลี่ยนอะไรไปบ้าง
sidebar:
  order: 1
---

ธีมมีหน้าที่วาดหน้าเว็บสาธารณะ ธีมเป็นเจ้าของ template และสไตล์ชีตของตัวเอง และไม่มีอะไรมากกว่านั้น การจัดเส้นทาง การดึงข้อมูลจากฐานข้อมูล ส่วน `<head>` กับแท็กสำหรับเครื่องมือค้นหา ฟอนต์ และ design token อยู่ในแกนของระบบทั้งหมด ธีมจึงทำให้เว็บช้าหรือผิดไม่ได้

ธีมมากับ repository เจ้าของเว็บเลือกธีมที่อยู่ในรุ่นนั้นได้จากหน้า[ธีม](/tome-cms/th/admin/themes/) และไม่มีทางติดตั้งธีมเพิ่มระหว่างที่เว็บทำงานอยู่ TomeCMS มีธีมสองแบบ คือ `paper` ซึ่งเป็นธีมตั้งต้น และ `plain` ธีมเรียบ ๆ ที่มีไว้เพื่อให้ข้อตกลงของธีมถูกใช้มากกว่าหนึ่งธีม วิธีเริ่มที่เร็วที่สุดคือคัดลอก `plain` ไปแก้

## ธีมประกอบด้วยอะไร

ธีมหนึ่งธีมคือโฟลเดอร์หนึ่งโฟลเดอร์ใต้ `src/themes/` และชื่อโฟลเดอร์คือ id ของธีม

| ไฟล์ | เก็บอะไร |
| --- | --- |
| `Shell.astro` | ทุกอย่างใน `<body>` ได้แก่ส่วนหัว ส่วนเนื้อหา และส่วนท้าย |
| `Home.astro` | รายการบทความในหน้าแรก |
| `Post.astro` | บทความหนึ่งบทความ |
| `Page.astro` | เพจหนึ่งเพจ |
| `theme.css` | สไตล์ชีตของธีมเอง |
| `theme.ts` | manifest ของธีม คือ id ชื่อ ประโยคที่หน้า "ธีม" แสดง และการตั้งค่าถ้ามี |
| `index.ts` | ส่งออก manifest กับ template ทั้งสี่ |

`index.ts` เหมือนกันทุกธีม

```ts
import Home from './Home.astro';
import Page from './Page.astro';
import Post from './Post.astro';
import Shell from './Shell.astro';

export { manifest } from './theme';

export { Home, Page, Post, Shell };
```

`src/themes/styles.ts` หา `theme.css` ของทุกธีมเอง แล้วหน้าเว็บจะลิงก์สไตล์ชีตของธีมที่ใช้อยู่ ผู้อ่านจึงดาวน์โหลดแค่สไตล์ชีตของธีมนั้น อย่า import `theme.css` จาก template เพราะการ build จะเอาสไตล์ชีตไปใส่ผิด bundle

Tailwind อ่านทุกไฟล์ใต้ `src/` เพื่อหาชื่อคลาส รวมถึงในคอมเมนต์ด้วย ถ้าเขียนชื่อคลาส utility ไว้ในคอมเมนต์ของธีม กฎของคลาสนั้นอาจไปอยู่ในทุกหน้าที่ผู้อ่านโหลด

## ข้อตกลงของธีม

`src/themes/contract.ts` บอกว่า template แต่ละตัวได้รับอะไรบ้าง template ทุกตัวประกาศ props ของตัวเองโดยต่อยอดจาก type ที่ตรงกัน

```astro
---
import type { ThemeHomeProps } from '../contract';

interface Props extends ThemeHomeProps {}
---
```

registry คืนค่าเป็น union ของ template จากทุกธีม ถ้า props ของ template ไหนไม่ตรงกับข้อตกลง การ build จะล้มตรงจุดที่ route เรียกใช้ template นั้น

| Template | Props | ได้รับอะไร |
| --- | --- | --- |
| `Shell` | `ThemeShellProps` | `themeSettings`, `allowVisitorTheme`, `alternates` (หน้าเดียวกันในอีกภาษา), `brand`, เมนู `header` กับ `footer`, `locale`, `showPoweredBy`, `siteName` และ `theme` ซึ่งเป็นโหมดสว่างหรือมืดที่เซิร์ฟเวอร์วาดมา |
| `Home` | `ThemeHomeProps` | `themeSettings`, `posts`, `categories`, `activeCategory`, `cursor` กับ `nextCursor` สำหรับไปหน้าถัดไปของรายการบทความ, `loadError`, `locale`, `profile`, `slides`, `siteName`, `tagline` และ `timezone` |
| `Post` | `ThemePostProps` | `themeSettings`, `post`, `categories`, `locale`, `profile`, `settings` (ชื่อเว็บและเขตเวลา) และ `preview` ซึ่งถูกตั้งไว้เมื่อเจ้าของเว็บกำลังดูฉบับร่าง |
| `Page` | `ThemePageProps` | `page`, `locale` และ `preview` เพจไม่ได้รับการตั้งค่าของธีม |

ทั้งหมดนี้คือข้อมูลที่ route มีอยู่แล้ว ธีมไม่มีทางดึงข้อมูลเพิ่มเอง และมีเทสต์ที่ล้มทันทีถ้าไฟล์ไหนในธีม import จาก `src/server/` หรือ `src/pages/`

`Shell` วาด slot สองตัว `<slot name="above" />` มาก่อนทุกอย่างที่ธีมวาด แกนของระบบจะใส่สิ่งที่ไม่ใช่ของธีมไว้ตรงนั้น เช่นแถบที่ปลั๊กอินส่งข้อความมาให้ และจุดที่โค้ดฝั่งเบราว์เซอร์ของปลั๊กอินมาเกาะ ส่วน `<slot />` ตัวปกติคือเนื้อหาของหน้า ซึ่งมักอยู่ใน `<main>` โลโก้วาดด้วยคอมโพเนนต์ `SiteBrand` ของแกนระบบ โดยส่ง `brand` กับ `siteName` ให้ เหมือนที่ `Shell.astro` ของ `plain` ทำ

## การตั้งค่าของธีม

ธีมให้แอดมินแสดงการตั้งค่าของธีมได้ โดยเขียนรายการการตั้งค่าไว้ใน manifest แกนของระบบจะวาดฟอร์มใน "ปรับแต่ง" บนหน้า "ธีม" เก็บคำตอบแยกไว้ให้ธีมนั้น แล้วส่งให้ template เป็น `themeSettings` หน้าที่เสนอการตั้งค่าไม่ต้องโหลดธีมขึ้นมาดูว่ามีการตั้งค่าอะไร manifest จึงอยู่ใน `theme.ts` แยกจาก template ธีมที่ไม่มี `settings` ก็ไม่มีอะไรให้ปรับแต่ง

| ช่อง | คืออะไร |
| --- | --- |
| `key` | ชื่อที่ template ใช้อ่านค่า เช่น `themeSettings.showDates` |
| `kind` | `choice`, `switch` หรือ `text` |
| `label` | ชื่อช่องบนฟอร์ม เขียนเป็น `{ en, th }` |
| `hint` | ข้อความหนึ่งบรรทัดใต้ช่อง เขียนเป็น `{ en, th }` ไม่ใส่ก็ได้ |
| `fallback` | ค่าที่ใช้จนกว่าเจ้าของเว็บจะเลือกเอง ต้องมี |
| `options` | ต้องมีเมื่อเป็น `choice` คือค่าที่เก็บได้ แต่ละค่ามี `label` ของตัวเอง |
| `max` | ต้องมีเมื่อเป็น `text` คือจำนวนตัวอักษรมากที่สุดที่เก็บได้ |

ค่าทุกค่าเป็นข้อความ สวิตช์เป็น `'on'` หรือ `'off'` ตัวเลือกเป็นค่าหนึ่งใน options และข้อความจะถูกตัดช่องว่างหัวท้ายออกและยาวไม่เกิน `max` ตัวอักษร ถ้าบันทึกค่าที่ผิดจากนี้ เซิร์ฟเวอร์จะปฏิเสธและบอกชื่อการตั้งค่านั้น เช่น `Headline is longer than 60 characters.`

template จะได้ทุก key ที่ manifest ประกาศไว้เสมอ key ที่เจ้าของเว็บยังไม่เคยเลือกจะได้ค่า `fallback` ค่าที่เก็บไว้แต่ธีมไม่มีให้เลือกแล้ว เช่นตัวเลือกที่ถูกเอาออกในรุ่นหลัง ก็จะได้ `fallback` เหมือนกัน ส่วน key ที่ manifest เลิกประกาศไปแล้วจะไม่ถูกส่งมาเลย

manifest นี้มีสวิตช์ ข้อความหนึ่งบรรทัด และตัวเลือก

```ts
import type { ThemeManifest } from '../contract';

/** Kept apart from the templates so the admin can name the theme without loading it. */
export const manifest: ThemeManifest = {
  description: 'Titles and dates in one column, like a ledger.',
  id: 'ledger',
  name: 'Ledger',
  settings: [
    {
      fallback: 'on',
      key: 'showDates',
      kind: 'switch',
      label: { en: 'Show dates', th: 'แสดงวันที่' },
    },
    {
      fallback: '',
      hint: { en: 'Left blank, the tagline is shown.', th: 'ถ้าเว้นว่าง จะแสดงข้อความประจำเว็บไซต์' },
      key: 'intro',
      kind: 'text',
      label: { en: 'Introduction', th: 'คำนำ' },
      max: 80,
    },
    {
      fallback: 'roomy',
      key: 'spacing',
      kind: 'choice',
      label: { en: 'Spacing', th: 'ระยะห่าง' },
      options: [
        { label: { en: 'Roomy', th: 'โปร่ง' }, value: 'roomy' },
        { label: { en: 'Compact', th: 'กระชับ' }, value: 'compact' },
      ],
    },
  ],
};
```

และ `Home.astro` ของธีมนี้อ่านค่าเหล่านั้นแบบนี้

```astro
---
import { postPath } from '../../lib/i18n';
import type { ThemeHomeProps } from '../contract';

interface Props extends ThemeHomeProps {}

const { posts, tagline, themeSettings } = Astro.props;
const showDates = themeSettings.showDates === 'on';
const intro = themeSettings.intro || tagline;
---

<div class={`ledger-home ledger-home--${themeSettings.spacing}`}>
  <p>{intro}</p>
  <ol>
    {posts.map((post) => (
      <li>
        <a href={postPath(post)}>{post.title}</a>
        {showDates && post.published_at && <time datetime={post.published_at}>{post.published_at.slice(0, 10)}</time>}
      </li>
    ))}
  </ol>
</div>
```

## ลงทะเบียนธีม

1. คัดลอก `src/themes/plain/` ไปเป็นโฟลเดอร์ชื่อเดียวกับธีมใหม่ เช่น `src/themes/ledger/`
2. ใน `theme.ts` ของธีมนั้น ตั้ง `id` ให้ตรงกับชื่อโฟลเดอร์ แล้วใส่ `name` กับ `description` หนึ่งประโยค หน้า "ธีม" แสดงประโยคนี้ตามที่เขียนไว้ทั้งในหน้าแอดมินภาษาไทยและภาษาอังกฤษ
3. เพิ่ม id ลงใน `THEMES` ใน `src/themes/registry.ts` แบบ dynamic import

   ```ts
   const THEMES = {
     paper: () => import('./paper'),
     plain: () => import('./plain'),
     ledger: () => import('./ledger'),
   } as const;
   ```

4. เพิ่ม manifest ของธีมลงใน `THEME_MANIFESTS` ใน `src/themes/manifests.ts`

   ```ts
   import { manifest as ledger } from './ledger/theme';

   export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain, ledger];
   ```

5. รัน `npm run check` และ `npm run test:unit`

ต้องเพิ่มทั้งสองที่ เพราะ registry คือทางที่หน้าเว็บเข้าถึง template ส่วน manifests คือทางที่แอดมินรู้ชื่อธีมโดยไม่ต้องโหลดธีม `tests/unit/theme-registry.test.ts` จะล้มถ้ารายชื่อธีมจากโฟลเดอร์ จาก registry และจาก manifests ไม่ตรงกัน และยังตรวจสิ่งที่ `index.ts` ส่งออกกับ props ของ template ทุกตัวด้วย

import ใน registry ต้องเป็นแบบ dynamic เสมอ ถ้า import ธีมตรง ๆ template และสไตล์ชีตของทุกธีมจะถูกรวมไปในทุกหน้าสาธารณะ แต่ dynamic import ทำให้เซิร์ฟเวอร์โหลดแค่ธีมที่การตั้งค่าระบุ ถ้าธีมที่เว็บเลือกไว้ถูกเอาออกในรุ่นหลัง เว็บนั้นจะถูกวาดด้วย `paper` แทน

## ตรวจว่าสไตล์ชีตเปลี่ยนอะไร

`css:snapshot` กับ `css:diff` เทียบ CSS ที่ได้จากการ build ทีละ selector ระหว่างก่อนกับหลังการแก้ สองคำสั่งนี้อ่านสไตล์ชีตที่ build แล้ว จึงต้อง build ก่อน และต้องให้ไฟล์เดียวกันกับทั้งสองคำสั่ง

```sh
npm run build
npm run css:snapshot -- /tmp/css-before.json
# change the stylesheets
npm run build
npm run css:diff -- /tmp/css-before.json
```

`css:diff` พิมพ์จำนวน selector ที่หายไป ที่เพิ่มมา และที่ declaration เปลี่ยน แล้วแสดงรายการทีละตัว คำสั่งจะจบด้วย error ก็ต่อเมื่อ selector ที่ยังอยู่ได้ declaration ชุดใหม่ไป selector ที่ตั้งใจลบควรขึ้นในรายการ แต่ declaration ที่เปลี่ยนแทบไม่ควรเกิดเลย เพราะการลบ selector ตัวสุดท้ายของกลุ่มอาจทำให้ selector ที่เหลือข้างบนไปผูกกับกฎถัดไป และไม่มีใครเห็นเรื่องนี้จาก patch

เครื่องมือนี้ช่วยให้การแบ่งระหว่าง `src/styles/global.css` ของแกนระบบกับ `theme.css` ของแต่ละธีมยังตรงตามที่ตั้งใจ `npm run check` รันแค่การทดสอบตัวเองของสคริปต์ เมื่อย้ายกฎระหว่างสไตล์ชีต ให้รันสองคำสั่งนี้เอง
