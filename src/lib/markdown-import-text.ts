import { fill, type AdminCopy } from './admin-i18n';
import type { ImportLimit, ImportWarning } from './markdown-import';

type Text = AdminCopy['markdownImport'];

/** What the server said when it refused a request: its status, and the warning it carried, if any. */
export interface ImportRefusal {
  status: number;
  warning?: ImportWarning;
}

/** One line per limit, typed on the union so a limit added to it is a build error until it has words. */
const LIMIT_LINES = {
  blocks: 'limitBlocks',
  'block-lines': 'limitBlockLines',
  definitions: 'limitDefinitions',
  depth: 'limitDepth',
  emphasis: 'limitEmphasis',
  html: 'limitHtml',
  inline: 'limitInline',
  lines: 'limitLines',
  pictures: 'limitPictures',
  size: 'limitSize',
  time: 'limitTime',
} as const satisfies Record<ImportLimit, keyof Text>;

/** Why a request did not go through, in the admin's words and with what to do next. */
export function refusalText(text: Text, refusal: ImportRefusal | undefined): string {
  const warning = refusal?.warning;
  if (warning?.code === 'too-complex') return text[LIMIT_LINES[warning.limit]];
  if (warning?.code === 'busy') return text.busy;
  return refusal?.status === 413 ? text.tooLarge : text.failed;
}

/** One note of the report of a finished import. */
export function warningText(text: Text, warning: ImportWarning): string {
  switch (warning.code) {
    case 'frontmatter-unreadable': return text.reportFrontmatter;
    case 'status-ignored': return text.reportStatus;
    case 'date-unreadable': return text.reportDate;
    case 'html-removed': return text.reportHtml;
    case 'links-removed': return text.reportLinks;
    case 'task-list': return text.reportTask;
    case 'category-missing': return fill(text.reportCategory, { names: warning.names.join(', ') });
    case 'slug-changed': return fill(text.reportSlug, { slug: warning.slug });
    // The request failed, so there is no report to put these in; they are refusals.
    case 'too-complex':
    case 'busy': return refusalText(text, { status: 0, warning });
  }
}
