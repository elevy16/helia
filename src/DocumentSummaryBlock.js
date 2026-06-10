import React, { useRef, useState, useLayoutEffect } from 'react';
import { parseSummaryMarkdown } from './markdownSummary';
import { helia } from './heliaTheme';

export default function DocumentSummaryBlock({ text, idPrefix, expanded, onToggle, truncate = true }) {
  const bodyRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    if (!text || !truncate) {
      setOverflows(false);
      return;
    }
    if (expanded) return;
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      if (!bodyRef.current) return;
      setOverflows(bodyRef.current.scrollHeight > bodyRef.current.clientHeight + 2);
    };
    requestAnimationFrame(measure);
  }, [text, expanded, truncate]);

  if (!text) return null;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${helia.border}` }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: helia.muted,
          marginBottom: 8,
        }}
      >
        Summary
      </div>
      <div
        ref={bodyRef}
        style={{
          fontSize: 15,
          lineHeight: 1.55,
          color: helia.body,
          wordBreak: 'break-word',
          ...(expanded || !truncate
            ? { maxHeight: 'none', overflow: 'visible' }
            : { maxHeight: '4.65em', overflow: 'hidden' }),
        }}
      >
        {parseSummaryMarkdown(text, idPrefix)}
      </div>
      {truncate && (overflows || expanded) && (
        <button
          type="button"
          onClick={onToggle}
          style={{
            marginTop: 10,
            padding: 0,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: helia.sage,
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
