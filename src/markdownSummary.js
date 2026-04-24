import React from 'react';

const HEADING_STYLES = {
  1: { fontSize: 22, fontWeight: 700, color: '#d4ead4', margin: '18px 0 10px', lineHeight: 1.25 },
  2: { fontSize: 19, fontWeight: 650, color: '#cde6cd', margin: '16px 0 8px', lineHeight: 1.3 },
  3: { fontSize: 17, fontWeight: 600, color: '#c5d9c5', margin: '14px 0 8px', lineHeight: 1.35 },
  4: { fontSize: 15, fontWeight: 600, color: '#b8d4b8', margin: '12px 0 6px', lineHeight: 1.4 },
  5: { fontSize: 14, fontWeight: 600, color: '#a8c5a0', margin: '10px 0 6px', lineHeight: 1.4 },
  6: { fontSize: 13, fontWeight: 600, color: '#9fb89f', margin: '8px 0 4px', lineHeight: 1.45 },
};

/** Inline **bold** / __bold__ → React nodes */
function parseBoldInline(line, keyPrefix) {
  const out = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;
  let m;
  let n = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      out.push(line.slice(last, m.index));
    }
    out.push(
      <strong key={`${keyPrefix}-b-${n++}`} style={{ color: '#eef5ee', fontWeight: 600 }}>
        {m[1] || m[2]}
      </strong>
    );
    last = re.lastIndex;
  }
  if (last < line.length) {
    out.push(line.slice(last));
  }
  return out.length ? out : [line];
}

/**
 * Basic markdown: ATX headings (#–######), bullets, numbered lists, paragraphs, **bold**
 */
export function parseSummaryMarkdown(text, idPrefix) {
  if (!text || !text.trim()) return null;
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const headingM = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingM) {
      const rawContent = headingM[2].trim();
      if (!rawContent) {
        i++;
        continue;
      }
      const level = Math.min(Math.max(headingM[1].length, 1), 6);
      const k = blockKey++;
      const tag = `h${level}`;
      blocks.push(
        React.createElement(
          tag,
          {
            key: `${idPrefix}-h-${k}`,
            style: { ...HEADING_STYLES[level], wordBreak: 'break-word' },
          },
          parseBoldInline(rawContent, `${idPrefix}-h-${k}-t`)
        )
      );
      i++;
      continue;
    }

    const bulletM = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletM) {
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(/^\s*[-*]\s+(.*)$/);
        if (lm) {
          items.push(lm[1]);
          i++;
        } else {
          break;
        }
      }
      const k = blockKey++;
      blocks.push(
        <ul
          key={`${idPrefix}-ul-${k}`}
          style={{
            margin: '4px 0 8px',
            paddingLeft: 18,
            listStyleType: 'disc',
            color: '#c8dcc8',
          }}
        >
          {items.map((item, j) => (
            <li key={j} style={{ marginBottom: 6, lineHeight: 1.55 }}>
              {parseBoldInline(item, `${idPrefix}-ul-${k}-li-${j}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    const numM = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numM) {
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (lm) {
          items.push(lm[1]);
          i++;
        } else {
          break;
        }
      }
      const k = blockKey++;
      blocks.push(
        <ol
          key={`${idPrefix}-ol-${k}`}
          style={{
            margin: '4px 0 8px',
            paddingLeft: 20,
            listStyleType: 'decimal',
            color: '#c8dcc8',
          }}
        >
          {items.map((item, j) => (
            <li key={j} style={{ marginBottom: 6, lineHeight: 1.55 }}>
              {parseBoldInline(item, `${idPrefix}-ol-${k}-li-${j}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const para = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^\s*#{1,6}\s/.test(l)) break;
      if (/^\s*[-*]\s+/.test(l)) break;
      if (/^\s*\d+\.\s+/.test(l)) break;
      para.push(l);
      i++;
    }
    const merged = para.join(' ');
    const k = blockKey++;
    blocks.push(
      <p key={`${idPrefix}-p-${k}`} style={{ margin: '4px 0 8px', lineHeight: 1.55, color: '#c8dcc8' }}>
        {parseBoldInline(merged, `${idPrefix}-p-${k}`)}
      </p>
    );
  }

  return <>{blocks}</>;
}
