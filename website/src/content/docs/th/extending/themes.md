---
title: เขียนธีม
description: สร้างธีมของหน้าเว็บสาธารณะตามข้อตกลงของธีม ให้ธีมมีการตั้งค่าที่แอดมินเสนอให้เลือกได้ ลงทะเบียนธีม และตรวจว่าสไตล์ชีตเปลี่ยนอะไรไปบ้าง
sidebar:
  order: 1
---

ธีมมีหน้าที่วาดหน้าเว็บสาธารณะ ธีมเป็นเจ้าของ template และสไตล์ชีตของตัวเอง และไม่มีอะไรมากกว่านั้น การจัดเส้นทาง การดึงข้อมูลจากฐานข้อมูล ส่วน `<head>` กับแท็กสำหรับเครื่องมือค้นหา ฟอนต์ และ design token อยู่ในแกนของระบบทั้งหมด ธีมจึงทำให้เว็บช้าหรือผิดไม่ได้

ธีมมากับ repository เจ้าของเว็บเลือกธีมที่อยู่ในรุ่นนั้นได้จากหน้า[ธีม](/tome-cms/th/admin/themes/) และไม่มีทางติดตั้งธีมเพิ่มระหว่างที่เว็บทำงานอยู่ TomeCMS มีธีมสามแบบ คือ `paper` ซึ่งเป็นธีมตั้งต้น `plain` ธีมเรียบ ๆ ที่มีไว้เพื่อให้ข้อตกลงของธีมถูกใช้มากกว่าหนึ่งธีม และ `almanac` ธีมโทนอบอุ่นที่มีหัวข้อแบบตัวมีหัว แถบหัวเรื่อง แถวป้ายหมวดหมู่ และตารางการ์ด เป็นตัวอย่างของธีมที่มีฟอนต์ การตั้งค่า และแถบที่ขยับตามการเลื่อนหน้าเป็นของตัวเอง วิธีเริ่มที่เร็วที่สุดคือคัดลอก `plain` ไปแก้ และถ้าอยากดูธีมที่ทำได้มากกว่านั้นให้อ่าน `almanac`

## เริ่มต้นด้วย tome

ใน source checkout ของ TomeCMS คำสั่ง `tome` ช่วยเริ่มธีมให้ได้ เป็นโปรแกรมตัวเดียวกับ[คำสั่ง `tome`](/tome-cms/th/cli/)บนเซิร์ฟเวอร์ แต่ชุดคำสั่งนี้มีไว้ใช้ตอนพัฒนา คือรันจาก checkout ด้วย `npm run tome --` ไม่ต้องใช้ `sudo` และปฏิเสธเมื่อรันที่อื่น

```sh
npm run tome -- theme new ledger
npm run tome -- theme new ledger --from almanac
npm run tome -- theme new ledger --dry-run
```

| อาร์กิวเมนต์หรือตัวเลือก | ทำอะไร |
| --- | --- |
| `id` | id ของธีมใหม่ เป็นตัวอักษรพิมพ์เล็กและตัวเลข 2 ถึง 31 ตัว ขึ้นต้นด้วยตัวอักษร ไม่มีเครื่องหมายขีดกลาง เพราะ id ยังเป็นชื่อที่ใช้ import ด้วย คำสั่งจะปฏิเสธเมื่อมี `src/themes/<id>` อยู่แล้ว เมื่อ id นั้นอยู่ใน `manifests.ts` หรือ `registry.ts` แล้ว หรือเมื่อเป็น utility ของ Tailwind ที่เป็นคำเดียว เช่น `grid` เพราะ id ยังเป็น class ของ body ด้วย |
| `--from THEME` | ธีมที่จะคัดลอก ได้แก่ `plain` (ค่าเริ่มต้น) `paper` หรือ `almanac` |
| `--dry-run` | แสดงสิ่งที่จะทำ โดยไม่เขียนอะไรเลย |

คำสั่งนี้คัดลอก `src/themes/<from>/` ไปไว้ที่ `src/themes/<id>/` จึงได้จุดเริ่มต้นที่ตรงกับข้อตกลงของธีมรุ่นปัจจุบันเสมอ ไม่ใช่แม่แบบเก่า ในสำเนาจะเปลี่ยนชื่อสิ่งที่มีชื่อของธีมต้นทางอยู่ ดังนี้

- `id` ใน manifest รวมถึง `name` และ `description` ซึ่งทั้งหมดจะกลายเป็น id ให้คุณไปเขียนใหม่
- class, id ขององค์ประกอบ และ custom property ทุกตัวที่ขึ้นต้นด้วยชื่อของธีมต้นทาง เช่น `.almanac-card` เป็น `.ledger-card`
- class ของธีมเองบน `<body>` และในสไตล์ชีต เช่น `body.almanac` เป็น `body.ledger`

คอมเมนต์ที่แค่พูดถึงธีมต้นทางจะไม่ถูกแก้ และ custom property ของแกนระบบ เช่น `--color-paper-2` ก็ไม่ถูกเปลี่ยนชื่อ ชื่อที่ขึ้นต้นด้วย `<from>-` ซึ่งแกนระบบใช้เองก็เช่นกัน สำเนาของ `plain` จึงยังมี `plain-body` อยู่ เพราะ `code.css` ของแกนระบบใช้ชื่อนี้จัดรูปบล็อกโค้ดที่อยู่ข้างใน

ฟอนต์ไม่ถูกคัดลอก ถ้าธีมต้นทางโหลดฟอนต์ของตัวเอง เหมือน `almanac` ที่ใช้ Trirong สไตล์ชีตใหม่จะ import `fonts.css` ของธีมต้นทาง ทั้งสองธีมจึงโหลดไฟล์ชุดเดียวกันใน `public/fonts/`

จากนั้นคำสั่งจะลงทะเบียนธีมให้ คือเพิ่ม import และรายการใน `THEME_MANIFESTS` ลงใน `src/themes/manifests.ts` และเพิ่ม dynamic import ลงใน `src/themes/registry.ts` คำสั่งเขียนโฟลเดอร์ใหม่ก่อน และลบทิ้งอีกครั้งถ้าลงทะเบียนไม่สำเร็จ จึงไม่ทิ้งธีมที่ทำค้างไว้ ถ้ารายการใดอยู่ในรูปแบบที่คำสั่งไม่รู้จัก จะไม่เปลี่ยนอะไรเลย แสดงบรรทัดที่ต้องเพิ่มด้วยมือ และจบด้วย exit code 1 ผลของ `theme new ledger --dry-run` เป็นดังนี้

```text
$ npm run tome -- theme new ledger --dry-run
Would create:
  src/themes/ledger/Home.astro
  src/themes/ledger/Page.astro
  src/themes/ledger/Post.astro
  src/themes/ledger/Shell.astro
  src/themes/ledger/index.ts
  src/themes/ledger/lead.ts
  src/themes/ledger/theme.css
  src/themes/ledger/theme.ts
Would add to src/themes/manifests.ts:
  import { manifest as ledger } from './ledger/theme';
  export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain, almanac, ledger];
Would add to src/themes/registry.ts:
    ledger: () => import('./ledger'),
Nothing was written.
```

ถ้าไม่ใส่ `--dry-run` คำสั่งจะจบด้วยขั้นตอนถัดไปที่ควรทำ

```text
Next:
  npm run dev
  Choose ledger under Appearance → Themes.
  npm run tome -- check
```

ธีมนี้เลือกใช้ได้แล้วที่หน้า[ธีม](/tome-cms/th/admin/themes/) จากนั้น[`tome check`](/tome-cms/th/cli/themes-and-plugins/)จะตรวจสิ่งที่ pull request มักถูกส่งกลับเพราะมัน เช่น ไฟล์ที่ขาด manifest ที่ไม่ตรงกับชื่อโฟลเดอร์ การตั้งค่าที่ไม่มีครบทั้งสองภาษา ธีมที่ import จาก `src/server/` และสไตล์ชีตที่ไม่ใช้ design token หัวข้อถัดไปอธิบายว่าแต่ละไฟล์มีไว้ทำอะไร และหัวข้อ[ลงทะเบียนธีม](#ลงทะเบียนธีม)ทำด้วยมือในสิ่งที่ `tome` เพิ่งทำให้

## ธีมประกอบด้วยอะไร

ธีมหนึ่งธีมคือโฟลเดอร์หนึ่งโฟลเดอร์ใต้ `src/themes/` และชื่อโฟลเดอร์คือ id ของธีม

| ไฟล์ | เก็บอะไร |
| --- | --- |
| `Shell.astro` | ทุกอย่างใน `<body>` ได้แก่ส่วนหัว ส่วนเนื้อหา และส่วนท้าย |
| `Home.astro` | รายการบทความในหน้าแรก |
| `Post.astro` | บทความหนึ่งบทความ |
| `Page.astro` | เพจหนึ่งเพจ |
| `theme.css` | สไตล์ชีตของธีมเอง |
| `theme.ts` | manifest ของธีม คือ id ชื่อ ประโยคที่หน้า "ธีม" แสดง การตั้งค่าถ้ามี และฟอนต์ที่ธีมโหลดล่วงหน้า |
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
| `Home` | `ThemeHomeProps` | `themeSettings`, `posts` (แต่ละรายการเป็น `ThemeHomePost` ซึ่งอาจมี `categories` ของบทความนั้นมาด้วย), `categories`, `activeCategory`, `category` ซึ่งถูกตั้งไว้ในหน้าของหมวดหมู่, `query` คือสิ่งที่ผู้อ่านค้นหา, `cursor` กับ `nextCursor` สำหรับไปหน้าถัดไปของรายการบทความ, `loadError`, `locale`, `profile`, `slides`, `siteName`, `tagline` และ `timezone` |
| `Post` | `ThemePostProps` | `themeSettings`, `post`, `categories`, `locale`, `profile`, `settings` (ชื่อเว็บและเขตเวลา) และ `preview` ซึ่งถูกตั้งไว้เมื่อเจ้าของเว็บกำลังดูฉบับร่าง |
| `Page` | `ThemePageProps` | `page`, `locale` และ `preview` เพจไม่ได้รับการตั้งค่าของธีม |

เมื่อ `query` มีค่า route ได้กรอง `posts` เหลือเฉพาะบทความที่ตรงกันแล้ว สิ่งที่ template ของ `Home` ต้องทำเองคือ

- วาด `<form role="search" method="get">` ที่ช่องกรอกชื่อ `q` เพื่อให้ค้นได้โดยไม่ต้องมีสคริปต์ และใส่ `query` ปัจจุบันกลับลงในช่อง
- บอกว่าค้นหาอะไรและออกจากการค้นหาได้อย่างไร โดยแสดงคำของผู้อ่านเป็นข้อความ ไม่ใช่ markup
- สร้างลิงก์ไปบทความเก่ากว่าด้วย `listHref` ซึ่งใส่ `q` และ `category` ให้
- วาดผลลัพธ์ก่อน hero และบอกเมื่อไม่มีอะไรตรงกัน

ธีมที่มากับระบบทั้งสามทำครบแล้ว ส่วนการส่ง `noindex, follow` สำหรับหน้าผลการค้นหา route ทำให้ template ไม่ต้องทำอะไร

ตั้งแต่ 1.20.0 template ของ `Home` ยังใช้วาดหน้าของแต่ละหมวดหมู่ด้วย คือ `/th/category/<slug>` ในหน้านี้ prop `category` ซึ่งไม่บังคับจะมีค่า ได้แก่ `name` ของหมวดหมู่ `description` ในภาษาของหน้า (เป็น `''` ถ้าไม่มี) และ `path` ของหน้า ให้ตั้งชื่อรายการด้วยค่านี้แบบเดียวกับรายการที่กรองหมวดหมู่ และวางคำอธิบายไว้ใต้ชื่อ หน้าถัดไปของรายการจะต่อจาก `category.path` ไม่ใช่หน้าแรก ลิงก์แบ่งหน้าทุกลิงก์จึงต้องสร้างด้วย `listHref(home, Astro.props, cursor)` จาก `src/themes/list-href.ts` ห้ามประกอบเอง เพราะลิงก์ที่ประกอบเองจะพาผู้อ่านที่กำลังไล่ดูหมวดหมู่กลับไปหน้าแรก ธีมที่ไม่ได้ใช้ `category` ยัง build ผ่าน และจะวาดหน้านี้เป็นหน้าแรกที่กรองด้วย `activeCategory` ส่วนลิงก์ชื่อหมวดหมู่ให้ใช้ `categoryHref(locale, category)` จาก `src/lib/i18n.ts` ซึ่งให้ที่อยู่หน้าของหมวดหมู่ หรือตัวกรองบนหน้าแรกสำหรับหมวดเริ่มต้นที่ไม่มีหน้าของตัวเอง

`coverImage` ของบทความมีขนาดของภาพและความกว้างของภาพขนาดเล็กที่มี ให้กระจาย `responsiveAttrs(post.coverImage, sizes)` จาก `src/lib/responsive-image.ts` ลงบน `<img>` เพื่อได้ `srcset` และ `sizes` โดยตั้ง `sizes` ให้ตรงกับความกว้างคอลัมน์ของธีม

ทั้งหมดนี้คือข้อมูลที่ route มีอยู่แล้ว ธีมไม่มีทางดึงข้อมูลเพิ่มเอง และมีเทสต์ที่ล้มทันทีถ้าไฟล์ไหนในธีม import จาก `src/server/` หรือ `src/pages/`

`Shell` วาด slot สองตัว `<slot name="above" />` มาก่อนทุกอย่างที่ธีมวาด แกนของระบบจะใส่สิ่งที่ไม่ใช่ของธีมไว้ตรงนั้น เช่นแถบที่ปลั๊กอินส่งข้อความมาให้ และจุดที่โค้ดฝั่งเบราว์เซอร์ของปลั๊กอินมาเกาะ ส่วน `<slot />` ตัวปกติคือเนื้อหาของหน้า ซึ่งมักอยู่ใน `<main>` โลโก้วาดด้วยคอมโพเนนต์ `SiteBrand` ของแกนระบบ โดยส่ง `brand` กับ `siteName` ให้ เหมือนที่ `Shell.astro` ของ `plain` ทำ

## วาดเมนูย่อย

เมนู `header` กับ `footer` ที่ `Shell` ได้รับเป็นรายการของ `PublicNavigationItem` จาก `src/types/cms.ts` ตั้งแต่ 1.10.0 มี `children` เพิ่มเข้ามา และ `href` กับ `kind` รับกลุ่มได้แล้ว

| ฟิลด์ | เก็บอะไร |
| --- | --- |
| `href` | ลิงก์ หรือ `null` ถ้าเป็นกลุ่ม มีแต่กลุ่มที่ไม่มีลิงก์ |
| `kind` | `home`, `page`, `custom` หรือ `group` |
| `label` | ข้อความที่ผู้อ่านเห็น |
| `newTab` | เจ้าของเว็บต้องการให้ลิงก์เปิดในแท็บใหม่ ธีมเป็นคนใส่ `target` กับ `rel` |
| `children` | รายการย่อยของรายการนี้ มีให้เสมอ เป็นรายการว่างสำหรับรายการธรรมดา รายการย่อย และทุกรายการในส่วนท้าย |

รายการใน `header` ที่มีอะไรอยู่ข้างใต้จะมี `children` ซึ่งลึกได้ชั้นเดียว `children` ของรายการย่อยจึงว่างเสมอ และรายการย่อยไม่เป็น `group` ส่วน `footer` เป็นแบบเรียบ รายการในนั้นเป็นลิงก์ที่ `children` ว่าง กลุ่มมีได้เฉพาะใน `header` และมีรายการย่อยอย่างน้อยหนึ่งรายการ เพราะแกนระบบตัดกลุ่มที่ไม่เหลือรายการย่อยออกไปแล้ว รายการหลักที่เพจของตัวเองยังไม่เผยแพร่จะมาถึงธีมเป็นกลุ่ม คือ `href: null` ตราบที่ยังมีรายการย่อยที่แสดงอยู่ template จึงสรุปเองไม่ได้ว่ารายการหลักมีลิงก์เสมอ

เมนูถูกแคชไว้และไม่ขึ้นกับหน้าที่กำลังดูอยู่ ธีมจึงหาเองว่าตอนนี้อยู่ส่วนไหนจากพาธของตัวเอง `isCurrentSection(item, pathname)` กับ `isLink(item)` อยู่ใน `src/lib/navigation-current.ts` template ของส่วนหัววาดรายการธรรมดาเป็นลิงก์ และรายการที่มี children เป็นเมนูย่อย

```astro
---
import SiteNavLink from '../../components/SiteNavLink.astro';
import SiteSubmenu from '../../components/SiteSubmenu.astro';
import SubmenuScript from '../../components/SubmenuScript.astro';
import { publicCopy } from '../../lib/i18n';
import { isLink } from '../../lib/navigation-current';

const { header, locale } = Astro.props;
const copy = publicCopy(locale);
const currentPath = Astro.url.pathname;
---

<ul>
  {header.map((item) => item.children.length
    ? <SiteSubmenu copy={copy} currentPath={currentPath} item={item} />
    : isLink(item) && <li><SiteNavLink copy={copy} currentPath={currentPath} item={item} /></li>)}
</ul>
{header.some(({ children }) => children.length) && <SubmenuScript />}
```

ธีมนำส่วนของแกนระบบสามส่วนไปใช้ซ้ำได้ และธีมที่มากับระบบทั้งสามก็ใช้

- `SiteNavLink` วาดลิงก์หนึ่งรายการแบบที่ทุกธีมควรทำ คือใส่ `aria-current` ให้หน้าที่กำลังดูอยู่ และมีข้อความสำหรับโปรแกรมอ่านหน้าจอเมื่อลิงก์เปิดในแท็บใหม่
- `SiteSubmenu` วาดรายการหลักหนึ่งรายการกับเมนูย่อยของมัน เป็น `<details>` ที่ใช้ `name` เดียวกันทั้งหมด เบราว์เซอร์จึงเปิดไว้ได้ทีละอัน โดยไม่ต้องมีสคริปต์เลย รายการหลักที่เป็นลิงก์จะมีปุ่ม ▾ อยู่ข้างลิงก์ ส่วนกลุ่มนั้นชื่อของมันคือปุ่ม ตกแต่ง `.site-submenu-item` กับ `.site-submenu` ในนั้น และ `summary` ด้วย token ของธีมเอง แผงจะมี `[data-align="end"]` เมื่อจะล้นขอบหน้าต่าง
- `SubmenuScript` คือสคริปต์ตัวเดียว หน้าหนึ่งต้องมีครั้งเดียว มันปิดเมนูย่อยที่เปิดอยู่เมื่อกด Escape เมื่อคลิกข้างนอก และเมื่อโฟกัสออกไปจากเมนู และใส่ `data-align="end"` ให้แผงที่จะล้นขอบหน้าต่าง ถ้าไม่มีสคริปต์นี้ เมนูย่อยก็ยังเปิดและปิดได้

ธีมที่วาด markup เองต้องคงพฤติกรรมเดียวกัน คือเมนูย่อยเปิดด้วยการคลิก ไม่ใช่การเลื่อนเมาส์ไปชี้ และมีปุ่มที่ชื่อบอกว่าเปิดเมนูไหน ข้อความของชื่อนั้นคือ `showMenu` ใน `publicCopy` ซึ่งในภาษาไทยคือ "แสดงเมนู {label}" ส่วนบนโทรศัพท์ ให้เรียงรายการย่อยไว้ใต้รายการหลักในเมนูของธีมเอง เหมือนที่ `Header.astro` ของ `paper` ทำ และวาดกลุ่มเป็นชื่อหัวข้อ ไม่ใช่ลิงก์

## การตั้งค่าของธีม

ธีมขอให้หน้าแอดมินแสดงการตั้งค่าของธีมได้ โดยเขียนรายการการตั้งค่าไว้ใน manifest แกนของระบบจะวาดฟอร์มใน "ปรับแต่ง" บนหน้า "ธีม" เก็บคำตอบแยกไว้ให้ธีมนั้น แล้วส่งให้ template เป็น `themeSettings` หน้าที่เสนอการตั้งค่าไม่ต้องโหลดธีมขึ้นมาดูว่ามีการตั้งค่าอะไร manifest จึงอยู่ใน `theme.ts` แยกจาก template ธีมที่ไม่มี `settings` ก็ไม่มีอะไรให้ปรับแต่ง

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

## ฟอนต์ที่ธีมโหลดล่วงหน้า

`preloadFonts` ใน manifest คือรายการไฟล์ฟอนต์ที่หน้าเว็บขอโหลดก่อนที่สไตล์ชีตของธีมจะขอ เขียนเป็นพาธใต้ `public/`

```ts
  preloadFonts: ['/fonts/google-sans-latin-400-normal.woff2', '/fonts/google-sans-thai-400-normal.woff2'],
```

แต่ละพาธเขียนเป็น `/fonts/<file>.woff2` คือไฟล์ `.woff2` ที่อยู่ใน `public/fonts/` โดยตรง ไม่อยู่ในโฟลเดอร์ย่อย หน้าเว็บโหลดแต่ละไฟล์ล่วงหน้าในฐานะฟอนต์ ถ้าใส่สไตล์ชีตหรือไอคอนไว้ในรายการ ไฟล์นั้นจะถูกดาวน์โหลดแล้วทิ้งไปเปล่า ๆ ใส่เฉพาะฟอนต์ที่ใช้วาดหน้าจอแรก ตัวอักษรจะได้ไม่เปลี่ยนหน้าตาทีหลัง และอย่าใส่เกินจำเป็น เพราะทุกไฟล์ในรายการถูกดาวน์โหลดในทุกหน้า

`preloadFonts` ไม่จำเป็นต้องมี ธีมที่ไม่มีจะไม่โหลดฟอนต์ใดล่วงหน้าเลย ฟอนต์ของธีมนั้นจะโหลดเมื่อสไตล์ชีตขอ

`tome check` อ่านรายการนี้ และแจ้งพาธที่ไม่ใช่ไฟล์ `.woff2` ใน `public/fonts/` ที่บรรทัดที่เขียนพาธนั้นไว้

```text
src/themes/ledger/theme.ts:9: preloads "/fonts/ledger.css", which is not a .woff2 file in public/fonts/
```

`tome theme new` คัดลอกรายการนี้ไปไว้ใน `theme.ts` ของธีมใหม่ ธีมที่สร้างจาก Almanac หรือ Paper จึงเริ่มต้นด้วยฟอนต์ของธีมนั้นที่โหลดล่วงหน้าไว้แล้ว ถ้าธีมใหม่วาดหน้าจอแรกด้วยฟอนต์อื่น ให้แก้รายการนี้

## ลงทะเบียนธีม

1. คัดลอก `src/themes/plain/` ไปเป็นโฟลเดอร์ชื่อเดียวกับธีมใหม่ เช่น `src/themes/ledger/`
2. ใน `theme.ts` ของธีมนั้น ตั้ง `id` ให้ตรงกับชื่อโฟลเดอร์ แล้วใส่ `name` กับ `description` หนึ่งประโยค หน้า "ธีม" แสดงประโยคนี้ตามที่เขียนไว้ทั้งในหน้าแอดมินภาษาไทยและภาษาอังกฤษ
3. เพิ่ม id ลงใน `THEMES` ใน `src/themes/registry.ts` แบบ dynamic import

   ```ts
   const THEMES = {
     paper: () => import('./paper'),
     plain: () => import('./plain'),
     almanac: () => import('./almanac'),
     ledger: () => import('./ledger'),
   } as const;
   ```

4. เพิ่ม manifest ของธีมลงใน `THEME_MANIFESTS` ใน `src/themes/manifests.ts`

   ```ts
   import { manifest as ledger } from './ledger/theme';

   export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain, almanac, ledger];
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
