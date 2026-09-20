import type { ThemeManifest } from '../contract';

/** Kept apart from the templates so the admin can name the theme without loading it. */
export const manifest: ThemeManifest = {
  description: 'Paper surfaces and hairline rules: the look TomeCMS ships with.',
  id: 'paper',
  name: 'Paper',
  settings: [
    {
      fallback: 'text',
      hint: {
        en: 'The band above the grid. Moving reveals the headline once, on arrival. Covers shows the newest posts that have one and falls back to text when none do; either way a reader who asked for less motion gets none.',
        th: 'แถบเหนือ grid — แบบเคลื่อนไหวจะเผยหัวข้อครั้งเดียวตอนเปิดหน้า ส่วนแบบปกจะแสดงบทความล่าสุดที่มีปก และกลับไปเป็นข้อความถ้าไม่มีสักบทความ ทั้งสองแบบจะไม่เคลื่อนไหวเลยกับผู้อ่านที่ขอการเคลื่อนไหวน้อยลง',
      },
      key: 'hero',
      kind: 'choice',
      label: { en: 'Hero', th: 'แถบหัวเรื่อง' },
      options: [
        { label: { en: 'Text', th: 'ข้อความ' }, value: 'text' },
        { label: { en: 'Moving text', th: 'ข้อความแบบเคลื่อนไหว' }, value: 'animated' },
        { label: { en: 'Covers of the newest posts', th: 'ปกบทความล่าสุด' }, value: 'slider' },
        { label: { en: 'Hidden', th: 'ไม่แสดง' }, value: 'off' },
      ],
    },
    {
      fallback: '',
      hint: {
        en: 'Left blank, the hero says what the theme says, in the language the page is being read in. Not shown when the hero is covers.',
        th: 'ถ้าเว้นว่าง จะใช้ข้อความของธีมตามภาษาที่หน้านั้นถูกอ่าน — ไม่แสดงเมื่อเลือกแบบปกบทความ',
      },
      key: 'heroHeadline',
      kind: 'text',
      label: { en: 'Headline', th: 'หัวข้อ' },
      max: 60,
    },
    {
      fallback: '6',
      hint: {
        en: 'Multiples of six only: a page of six ends on a full row at one, two or three cards across, which is every width this grid has.',
        th: 'เลือกได้เฉพาะจำนวนที่หารด้วยหกลงตัว เพราะหกใบจบที่แถวเต็มพอดีทั้งตอน 1, 2 และ 3 คอลัมน์ ซึ่งเป็นทุกความกว้างที่ grid นี้มี',
      },
      key: 'postsPerLoad',
      kind: 'choice',
      label: { en: 'Posts per load', th: 'บทความต่อการโหลด' },
      options: [
        { label: { en: '6', th: '6' }, value: '6' },
        { label: { en: '12', th: '12' }, value: '12' },
        { label: { en: '18', th: '18' }, value: '18' },
      ],
    },
    {
      fallback: '3',
      hint: {
        en: 'At the widest. A row that cannot hold that many at a readable width holds fewer, so a phone is one across whatever this says.',
        th: 'เป็นจำนวนตอนจอกว้างที่สุด ถ้าแถวไม่พอให้การ์ดกว้างพอจะอ่านได้ ก็จะลดลงเอง — บนมือถือจึงเป็นคอลัมน์เดียวเสมอไม่ว่าตั้งไว้เท่าไร',
      },
      key: 'gridColumns',
      kind: 'choice',
      label: { en: 'Cards across', th: 'จำนวนคอลัมน์' },
      options: [
        { label: { en: '2', th: '2' }, value: '2' },
        { label: { en: '3', th: '3' }, value: '3' },
        { label: { en: '4', th: '4' }, value: '4' },
      ],
    },
    {
      fallback: 'off',
      hint: {
        en: 'A hairline across the top of an article, filling as the reader goes down it. The browser draws it from the scroll position, so the page carries nothing to keep it moving.',
        th: 'เส้นบางพาดบนสุดของบทความ เติมขึ้นตามที่อ่านลงไป เบราว์เซอร์วาดจากตำแหน่ง scroll เอง หน้าจึงไม่ต้องแบกโค้ดไว้ขยับมัน',
      },
      key: 'readingProgress',
      kind: 'switch',
      label: { en: 'Reading progress bar', th: 'แถบความคืบหน้าการอ่าน' },
    },
    {
      fallback: 'on',
      hint: {
        en: 'Rows appear as the end of the grid comes near. Off leaves the link to older posts that a reader without JavaScript already follows.',
        th: 'แถวใหม่จะโผล่เมื่อใกล้ถึงท้าย grid ถ้าปิด จะเหลือลิงก์ไปบทความเก่ากว่า ซึ่งเป็นลิงก์เดียวกับที่คนปิด JavaScript ใช้อยู่แล้ว',
      },
      key: 'infiniteScroll',
      kind: 'switch',
      label: { en: 'Load more as the reader scrolls', th: 'โหลดเพิ่มเมื่อเลื่อนลง' },
    },
  ],
};
