import type { ThemeManifest } from '../contract';

/** Kept apart from the templates so the admin can name the theme without loading it. */
export const manifest: ThemeManifest = {
  description: 'Paper surfaces and hairline rules: the look TomeCMS ships with.',
  id: 'paper',
  name: 'Paper',
  settings: [
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
