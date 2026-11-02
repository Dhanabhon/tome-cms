import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useRef } from 'react';

import { fill, type AdminCopy } from '../../../lib/admin-i18n';
import { postList, type PostListAttrs, type PostListOption } from '../../../lib/editor-post-list';
import type { PostCategorySummary, PostLocale } from '../../../types/cms';
import Icon from '../../Icon';
import { askForPostList } from './post-list-insert';
import { CATEGORIES_URL, postOptionsUrl, useAdminList } from './PostListDialog';

/** Saving a post refuses a block, so one pasted into a post is only named; there is nothing to set. */
function plainLabel(copy: AdminCopy) {
  return function PostListLabel() {
    return (
      <NodeViewWrapper className="post-list-box" contentEditable={false} data-drag-handle="">
        <div className="post-list-box__head"><Icon name="list" /><strong>{copy.blocks.postList}</strong></div>
      </NodeViewWrapper>
    );
  };
}

function Rows({ attrs, copy, options }: { attrs: PostListAttrs; copy: AdminCopy; options: PostListOption[] }) {
  if (!attrs.postGroupIds.length) return <p className="admin-hint">{copy.blocks.postListEmpty}</p>;
  return (
    <ol className="post-list-box__rows">
      {attrs.postGroupIds.map((group) => {
        const option = options.find((one) => one.groupId === group);
        if (!option) return <li className="post-list-box__off" key={group}>{copy.blocks.postListRowGone}</li>;
        return (
          <li key={group}>
            {option.title}
            {option.status !== 'published' && <small> {copy.status[option.status]} · {copy.blocks.postListRowNotYet}</small>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What a block will show, in words: the preview shows the real thing. The answers are read when the
 * box is drawn, so a post deleted in another tab is marked the next time the page is opened.
 */
function postListView(copy: AdminCopy, pageLocale: PostLocale) {
  return function PostListView({ node, updateAttributes }: NodeViewProps) {
    const attrs = node.attrs as PostListAttrs;
    const settings = useRef<HTMLButtonElement>(null);
    const options = useAdminList<PostListOption>(attrs.source === 'posts' ? postOptionsUrl(pageLocale) : null, 'options');
    const categories = useAdminList<PostCategorySummary>(attrs.source === 'category' ? CATEGORIES_URL : null, 'categories');
    const category = Array.isArray(categories) ? categories.find((one) => one.id === attrs.categoryId) : undefined;
    const layout = copy.blocks.postListLayouts[attrs.layout];

    const summary = attrs.source === 'posts'
      ? fill(copy.blocks.postListSummaryPosts, { layout })
      : category
        ? fill(copy.blocks.postListSummaryCategory, { count: attrs.limit, layout, name: category.name })
        : fill(copy.blocks.postListSummaryUnread, { layout });

    const openSettings = async () => {
      const next = await askForPostList(copy, pageLocale, attrs);
      if (next) updateAttributes(next);
      settings.current?.focus({ preventScroll: true });
    };

    return (
      <NodeViewWrapper className="post-list-box" contentEditable={false} data-drag-handle="">
        <div className="post-list-box__head">
          <Icon name="list" />
          <div className="post-list-box__summary"><strong>{copy.blocks.postList}</strong><span>{summary}</span></div>
          <button
            aria-label={copy.blocks.postListSettings}
            className="admin-button admin-button--secondary admin-button--icon"
            onClick={() => void openSettings()}
            ref={settings}
            title={copy.blocks.postListSettings}
            type="button"
          >
            <Icon name="settings" />
          </button>
        </div>
        {attrs.source === 'posts' && options === 'failed' && <p className="admin-hint">{copy.blocks.postListUnreadTitles}</p>}
        {attrs.source === 'posts' && Array.isArray(options) && <Rows attrs={attrs} copy={copy} options={options} />}
        {attrs.source === 'category' && categories === 'failed' && <p className="admin-hint">{copy.blocks.postListUnreadCategory}</p>}
        {attrs.source === 'category' && Array.isArray(categories) && !category && <p className="post-list-box__off">{copy.blocks.postListCategoryGone}</p>}
        {category?.postCount === 0 && <p className="admin-hint">{copy.blocks.postListCategoryEmpty}</p>}
      </NodeViewWrapper>
    );
  };
}

export const createEditorPostList = (copy: AdminCopy, pageLocale?: PostLocale) => postList.extend({
  addNodeView() {
    return ReactNodeViewRenderer(pageLocale ? postListView(copy, pageLocale) : plainLabel(copy));
  },
});
