import React from 'react';

/* Light-surface typography (Helia cards / cream UI) */
const HEADING_STYLES = {
  1: { fontSize: 24, fontWeight: 700, color: '#2d5a27', margin: '18px 0 10px', lineHeight: 1.25 },
  2: { fontSize: 21, fontWeight: 650, color: '#2d5a27', margin: '16px 0 8px', lineHeight: 1.3 },
  3: { fontSize: 19, fontWeight: 600, color: '#2d5a27', margin: '14px 0 8px', lineHeight: 1.35 },
  4: { fontSize: 17, fontWeight: 600, color: '#2d5a27', margin: '12px 0 6px', lineHeight: 1.4 },
  5: { fontSize: 16, fontWeight: 600, color: '#3d6a35', margin: '10px 0 6px', lineHeight: 1.4 },
  6: { fontSize: 15, fontWeight: 600, color: '#7a7a6e', margin: '8px 0 4px', lineHeight: 1.45 },
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
      <strong key={`${keyPrefix}-b-${n++}`} style={{ color: '#2d5a27', fontWeight: 600 }}>
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
            color: '#2c2c2c',
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
            color: '#2c2c2c',
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
      <p key={`${idPrefix}-p-${k}`} style={{ margin: '4px 0 8px', lineHeight: 1.55, color: '#2c2c2c' }}>
        {parseBoldInline(merged, `${idPrefix}-p-${k}`)}
      </p>
    );
  }

  return <>{blocks}</>;
}
