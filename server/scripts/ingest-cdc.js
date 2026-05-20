/**
 * Fetches CDC public RSS feeds and syndicated health topic content, chunks + embeds,
 * stores in medical_knowledge with topic_slug prefixed cdc-*.
 *
 * Usage: cd server && npm run ingest-cdc
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { chunkText, embedTextsBatched, toVectorParam } = require('../rag');

const USER_AGENT = 'Helia-Health-Ingest/1.0 (medical knowledge; contact: local-dev)';
const CDC_NEWSROOM_RSS = 'https://tools.cdc.gov/api/v2/resources/media/132608.rss';

/** RSS feeds: travel, MMWR, newsroom */
const CDC_RSS_SOURCES = [
  {
    slug: 'cdc-travel-health-notices',
    title: 'CDC Travel Health Notices',
    url: 'https://wwwnc.cdc.gov/travel/rss/notices.xml',
    citation: 'U.S. CDC Travel Health Notices',
  },
  {
    slug: 'cdc-mmwr-reports',
    title: 'CDC MMWR Reports',
    url: 'https://www.cdc.gov/mmwr/rss/mmwr.xml',
    citation: 'U.S. CDC Morbidity and Mortality Weekly Report (MMWR)',
  },
  {
    slug: 'cdc-newsroom-releases',
    title: 'CDC Newsroom Releases',
    url: CDC_NEWSROOM_RSS,
    citation: 'U.S. CDC Newsroom',
  },
];

/**
 * Keyword-filtered subsets of the CDC newsroom RSS for thematic guidelines.
 * Fetched once and split to avoid duplicate full-newsroom ingests.
 */
const CDC_NEWSROOM_FILTERS = [
  {
    slug: 'cdc-outbreak-health-alerts',
    title: 'CDC Outbreak & Health Alerts',
    keywords: ['outbreak', 'alert', 'emergency', 'cases', 'investigation', 'recall', 'warning'],
    citation: 'U.S. CDC — Outbreak & Health Alerts (Newsroom)',
  },
  {
    slug: 'cdc-preventive-care-guidelines',
    title: 'CDC Preventive Care Guidelines',
    keywords: ['prevent', 'screening', 'wellness', 'routine', 'checkup', 'immunization', 'vaccin'],
    citation: 'U.S. CDC — Preventive Care (Newsroom)',
  },
  {
    slug: 'cdc-heart-disease-prevention',
    title: 'CDC Heart Disease Prevention',
    keywords: ['heart', 'cardiovascular', 'stroke', 'blood pressure', 'hypertension', 'cholesterol'],
    citation: 'U.S. CDC — Heart Disease Prevention (Newsroom)',
  },
  {
    slug: 'cdc-diabetes-prevention',
    title: 'CDC Diabetes Prevention',
    keywords: ['diabetes', 'prediabetes', 'glucose', 'insulin', 'a1c'],
    citation: 'U.S. CDC — Diabetes Prevention (Newsroom)',
  },
  {
    slug: 'cdc-cancer-screening',
    title: 'CDC Cancer Screening & Prevention',
    keywords: ['cancer', 'mammogram', 'colon', 'screening', 'oncolog', 'tumor'],
    citation: 'U.S. CDC — Cancer Screening (Newsroom)',
  },
];

/** CDC syndicated HTML content (tools.cdc.gov content API) */
const CDC_SYNDICATE_SOURCES = [
  {
    slug: 'cdc-adult-vaccine-schedule',
    mediaId: 266012,
    title: 'CDC Adult Immunization Schedule by Age',
    citation: 'U.S. CDC — Recommended Adult Immunization Schedule',
  },
  {
    slug: 'cdc-child-vaccine-schedule',
    mediaId: 305571,
    title: 'CDC Child & Adolescent Immunization Schedule',
    citation: 'U.S. CDC — Child and Adolescent Immunization Schedule',
  },
  {
    slug: 'cdc-recommended-vaccines-children',
    mediaId: 305570,
    title: 'CDC Recommended Vaccines for Young Children',
    citation: 'U.S. CDC — Recommended Vaccines for Young Children',
  },
  {
    slug: 'cdc-vaccines-for-adults',
    mediaId: 737399,
    title: 'CDC Vaccines for Adults',
    citation: 'U.S. CDC — Vaccines for Adults',
  },
  {
    slug: 'cdc-diabetes-prevention-program',
    mediaId: 281797,
    title: 'CDC National Diabetes Prevention Program',
    citation: 'U.S. CDC — National Diabetes Prevention Program',
  },
  {
    slug: 'cdc-diabetes-basics',
    mediaId: 335185,
    title: 'CDC Diabetes Basics',
    citation: 'U.S. CDC — Diabetes Basics',
  },
  {
    slug: 'cdc-heart-disease-overview',
    mediaId: 224874,
    title: 'CDC Heart Disease Overview',
    citation: 'U.S. CDC — Heart Disease',
  },
  {
    slug: 'cdc-million-hearts',
    mediaId: 751080,
    title: 'CDC Million Hearts Initiative',
    citation: 'U.S. CDC — Million Hearts',
  },
  {
    slug: 'cdc-cancer-overview',
    mediaId: 351106,
    title: 'CDC Cancer Overview',
    citation: 'U.S. CDC — Cancer',
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractXmlTag(block, tag) {
  const cdata = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'));
  if (cdata) return cdata[1].trim();
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
  return plain ? plain[1].trim() : '';
}

function parseRssItems(xml, maxItems = 40) {
  const items = [];
  const blocks = [
    ...(xml.match(/<item[\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry[\s\S]*?<\/entry>/gi) || []),
  ];
  for (const block of blocks) {
    if (items.length >= maxItems) break;
    const title = stripHtml(extractXmlTag(block, 'title'));
    if (!title) continue;
    const description = stripHtml(
      extractXmlTag(block, 'description') ||
        extractXmlTag(block, 'summary') ||
        extractXmlTag(block, 'content')
    );
    const link =
      extractXmlTag(block, 'link') ||
      (block.match(/<link[^>]+href="([^"]+)"/i) || [])[1] ||
      '';
    const pubDate = stripHtml(extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'updated'));
    const body = [title, pubDate ? `Published: ${pubDate}` : '', description].filter(Boolean).join('\n\n');
    if (body.length < 80) continue;
    items.push({ title, link: stripHtml(link), body, haystack: `${title} ${description}`.toLowerCase() });
  }
  return items;
}

function filterItemsByKeywords(items, keywords, maxItems = 25) {
  const filtered = items.filter((it) => keywords.some((kw) => it.haystack.includes(kw.toLowerCase())));
  return filtered.slice(0, maxItems);
}

async function fetchUrl(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function storeKnowledge(supabase, openaiKey, meta, corpus) {
  if (!corpus || corpus.length < 120) {
    console.warn(`  Too little text for ${meta.slug}, skipping`);
    return 0;
  }

  const merged = `${meta.title}\n\n${corpus}`;
  const chunks = chunkText(merged, 500, 75);
  if (!chunks.length) return 0;

  const vectors = await embedTextsBatched(openaiKey, chunks);

  const { error: delErr } = await supabase.from('medical_knowledge').delete().eq('topic_slug', meta.slug);
  if (delErr) throw new Error(delErr.message);

  const rows = chunks.map((content, chunk_index) => ({
    topic_slug: meta.slug,
    topic_title: meta.title,
    source_url: meta.source_url,
    source_citation: meta.citation,
    chunk_index,
    content,
    embedding: toVectorParam(vectors[chunk_index]),
  }));

  const { error: insErr } = await supabase.from('medical_knowledge').insert(rows);
  if (insErr) throw new Error(insErr.message);
  return rows.length;
}

async function ingestRssSource(supabase, openaiKey, source) {
  console.log(`- ${source.slug} (RSS)`);
  const xml = await fetchUrl(source.url);
  const items = parseRssItems(xml, 35);
  if (!items.length) {
    console.warn(`  No RSS items for ${source.slug}`);
    return 0;
  }
  const corpus = items.map((it) => it.body).join('\n\n---\n\n');
  const link = items[0].link || source.url;
  const count = await storeKnowledge(supabase, openaiKey, {
    slug: source.slug,
    title: source.title,
    source_url: link,
    citation: source.citation,
  }, corpus);
  console.log(`  stored ${count} chunks from ${items.length} RSS items`);
  return count;
}

async function ingestNewsroomFilter(supabase, openaiKey, filterDef, allNewsroomItems) {
  console.log(`- ${filterDef.slug} (newsroom filter)`);
  const items = filterItemsByKeywords(allNewsroomItems, filterDef.keywords, 25);
  if (!items.length) {
    console.warn(`  No matching newsroom items for ${filterDef.slug}`);
    return 0;
  }
  const corpus = items.map((it) => it.body).join('\n\n---\n\n');
  const count = await storeKnowledge(supabase, openaiKey, {
    slug: filterDef.slug,
    title: filterDef.title,
    source_url: items[0].link || 'https://www.cdc.gov/media/',
    citation: filterDef.citation,
  }, corpus);
  console.log(`  stored ${count} chunks from ${items.length} filtered items`);
  return count;
}

async function ingestSyndicateSource(supabase, openaiKey, source) {
  console.log(`- ${source.slug} (syndicated content ${source.mediaId})`);
  const metaRes = await fetchUrl(`https://tools.cdc.gov/api/v2/resources/media/${source.mediaId}.json`);
  let sourceUrl = `https://tools.cdc.gov/api/v2/resources/media/${source.mediaId}/content.html`;
  try {
    const meta = JSON.parse(metaRes);
    if (meta?.results?.[0]?.sourceUrl) sourceUrl = meta.results[0].sourceUrl;
  } catch {
    // use default content url
  }

  const html = await fetchUrl(`https://tools.cdc.gov/api/v2/resources/media/${source.mediaId}/content.html`);
  const text = stripHtml(html);
  const count = await storeKnowledge(supabase, openaiKey, {
    slug: source.slug,
    title: source.title,
    source_url: sourceUrl,
    citation: source.citation,
  }, text);
  console.log(`  stored ${count} chunks`);
  return count;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('Missing OPENAI_API_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let totalChunks = 0;
  let successSources = 0;

  console.log(`Ingesting ${CDC_RSS_SOURCES.length} CDC RSS feeds…`);
  for (const source of CDC_RSS_SOURCES) {
    try {
      const n = await ingestRssSource(supabase, openaiKey, source);
      if (n > 0) successSources += 1;
      totalChunks += n;
    } catch (e) {
      console.error(`  FAILED ${source.slug}:`, e.message || e);
    }
    await sleep(800);
  }

  console.log(`\nFetching CDC newsroom for thematic filters…`);
  let newsroomItems = [];
  try {
    const xml = await fetchUrl(CDC_NEWSROOM_RSS);
    newsroomItems = parseRssItems(xml, 200);
    console.log(`  Parsed ${newsroomItems.length} newsroom items`);
  } catch (e) {
    console.error('  FAILED to fetch newsroom RSS:', e.message || e);
  }

  console.log(`\nIngesting ${CDC_NEWSROOM_FILTERS.length} themed newsroom filters…`);
  for (const filterDef of CDC_NEWSROOM_FILTERS) {
    try {
      const n = await ingestNewsroomFilter(supabase, openaiKey, filterDef, newsroomItems);
      if (n > 0) successSources += 1;
      totalChunks += n;
    } catch (e) {
      console.error(`  FAILED ${filterDef.slug}:`, e.message || e);
    }
    await sleep(800);
  }

  console.log(`\nIngesting ${CDC_SYNDICATE_SOURCES.length} CDC syndicated topic pages…`);
  for (const source of CDC_SYNDICATE_SOURCES) {
    try {
      const n = await ingestSyndicateSource(supabase, openaiKey, source);
      if (n > 0) successSources += 1;
      totalChunks += n;
    } catch (e) {
      console.error(`  FAILED ${source.slug}:`, e.message || e);
    }
    await sleep(800);
  }

  const { count, error } = await supabase
    .from('medical_knowledge')
    .select('*', { count: 'exact', head: true })
    .like('topic_slug', 'cdc-%');
  if (error) console.warn('Could not verify CDC row count:', error.message);
  else console.log(`\nDone. CDC sources with chunks: ${successSources}, total CDC chunks in DB: ${count ?? totalChunks}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
