import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './chat.module.css';

// The model's answer is untrusted input — it can carry a prompt injection
// from a tool result or a knowledge-base article. So: no raw HTML (no
// rehype-raw, and skipHtml), no images (a Markdown image is fetched by the
// browser on its own, which makes it a data-exfiltration channel), and an
// allowlist for links instead of react-markdown's blocklist-style default.
const SAFE_URL = /^(https?|mailto):/i;

/** Runs on the decoded URL; anything not allowlisted becomes plain text. */
function safeUrl(url: string): string {
  return SAFE_URL.test(url) ? url : '';
}

const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  table: ({ children }) => (
    <div className={styles.tableScroll}>
      <table>{children}</table>
    </div>
  ),
};

export interface AssistantMarkdownProps {
  text: string;
}

/**
 * The assistant's answer as Markdown. Memoized: while one answer streams,
 * the whole list re-renders on every chunk, but finished answers keep the
 * same props and are not parsed again.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
}: AssistantMarkdownProps) {
  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        urlTransform={safeUrl}
        components={COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  );
});
