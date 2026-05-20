/**
 * Fetches recent PubMed review/guideline abstracts via NCBI E-utilities (no API key),
 * chunks + embeds, stores in medical_knowledge with topic_slug prefixed pubmed-*.
 *
 * Usage: cd server && npm run ingest-pubmed
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * Rate limit: 1 request/second (NCBI guidelines without API key).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { chunkText, embedTextsBatched, toVectorParam } = require('../rag');

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const USER_AGENT = 'Helia-Health-Ingest/1.0 (medical knowledge; contact: local-dev)';
const RATE_LIMIT_MS = 1000;
const ARTICLES_PER_CONDITION = 4;
const MIN_YEAR = new Date().getFullYear() - 5;

/** Top 20 common conditions aligned with MedlinePlus knowledge base topics */
const PUBMED_CONDITIONS = [
  { slug: 'type-2-diabetes', term: 'diabetes mellitus type 2' },
  { slug: 'hypertension', term: 'hypertension' },
  { slug: 'depression', term: 'depression' },
  { slug: 'anxiety', term: 'anxiety disorders' },
  { slug: 'coronary-artery-disease', term: 'coronary artery disease' },
  { slug: 'heart-failure', term: 'heart failure' },
  { slug: 'asthma', term: 'asthma' },
  { slug: 'copd', term: 'chronic obstructive pulmonary disease' },
  { slug: 'obesity', term: 'obesity' },
  { slug: 'high-cholesterol', term: 'hyperlipidemia' },
  { slug: 'hypothyroidism', term: 'hypothyroidism' },
  { slug: 'osteoarthritis', term: 'osteoarthritis' },
  { slug: 'chronic-kidney-disease', term: 'chronic kidney disease' },
  { slug: 'gerd', term: 'gastroesophageal reflux' },
  { slug: 'sleep-apnea', term: 'sleep apnea' },
  { slug: 'stroke', term: 'stroke' },
  { slug: 'atrial-fibrillation', term: 'atrial fibrillation' },
  { slug: 'migraine', term: 'migraine' },
  { slug: 'iron-deficiency-anemia', term: 'iron deficiency anemia' },
  { slug: 'vitamin-d-deficiency', term: 'vitamin D deficiency' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractXmlTag(block, tag) {
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
  if (!plain) return '';
  return plain[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractAbstract(articleBlock) {
  const abstractBlock = articleBlock.match(/<Abstract>([\s\S]*?)<\/Abstract>/i);
  if (!abstractBlock) return '';
  const labels = abstractBlock[1].match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi) || [];
  if (labels.length) {
    return labels
      .map((part) => {
        const labelMatch = part.match(/Label="([^"]+)"/i);
        const text = part.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return labelMatch ? `${labelMatch[1]}: ${text}` : text;
      })
      .join('\n');
  }
  return abstractBlock[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractAuthors(articleBlock) {
  const authors = [];
  const authorBlocks = articleBlock.match(/<Author[^>]*>[\s\S]*?<\/Author>/gi) || [];
  for (const ab of authorBlocks.slice(0, 6)) {
    const last = extractXmlTag(ab, 'LastName');
    const fore = extractXmlTag(ab, 'ForeName');
    const collective = extractXmlTag(ab, 'CollectiveName');
    if (collective) authors.push(collective);
    else if (last) authors.push(fore ? `${last} ${fore}` : last);
  }
  if (authorBlocks.length > 6) authors.push('et al.');
  return authors.join(', ');
}

function extractJournalYear(articleBlock) {
  const journal = extractXmlTag(articleBlock, 'Title');
  const year =
    extractXmlTag(articleBlock.match(/<PubDate>[\s\S]*?<\/PubDate>/i)?.[0] || '', 'Year') ||
    extractXmlTag(articleBlock, 'Year');
  return { journal, year };
}

function parsePubMedXml(xml) {
  const articles = [];
  const blocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/gi) || [];
  for (const block of blocks) {
    const pmid = (block.match(/<PMID[^>]*>(\d+)<\/PMID>/i) || [])[1] || '';
    const title = extractXmlTag(block, 'ArticleTitle');
    const abstract = extractAbstract(block);
    const { journal, year } = extractJournalYear(block);
    const authors = extractAuthors(block);
    if (!title || !abstract || abstract.length < 80) continue;
    articles.push({ pmid, title, abstract, journal, year, authors });
  }
  return articles;
}

async function eutilsFetch(path, params) {
  const url = new URL(`${EUTILS_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('tool', 'helia-health');
  url.searchParams.set('email', 'dev@helia.local');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`E-utilities HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.text();
}

async function searchPubMed(conditionTerm) {
  const query = [
    `(${conditionTerm}[Title/Abstract])`,
    'AND (review[pt] OR "systematic review"[pt] OR guideline[pt] OR "practice guideline"[pt])',
    `AND ${MIN_YEAR}:${new Date().getFullYear()}[pdat]`,
  ].join(' ');

  const jsonText = await eutilsFetch('esearch.fcgi', {
    db: 'pubmed',
    term: query,
    retmax: String(ARTICLES_PER_CONDITION),
    retmode: 'json',
    sort: 'relevance',
  });
  await sleep(RATE_LIMIT_MS);

  const data = JSON.parse(jsonText);
  const ids = data?.esearchresult?.idlist || [];
  return ids;
}

async function fetchPubMedArticles(pmids) {
  if (!pmids.length) return [];
  const xml = await eutilsFetch('efetch.fcgi', {
    db: 'pubmed',
    id: pmids.join(','),
    retmode: 'xml',
  });
  await sleep(RATE_LIMIT_MS);
  return parsePubMedXml(xml);
}

function formatArticleCorpus(articles) {
  return articles
    .map((a) => {
      const meta = [
        `Title: ${a.title}`,
        a.authors ? `Authors: ${a.authors}` : '',
        a.journal ? `Journal: ${a.journal}${a.year ? ` (${a.year})` : ''}` : a.year ? `Year: ${a.year}` : '',
        a.pmid ? `PubMed ID: ${a.pmid}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return `${meta}\n\nAbstract:\n${a.abstract}`;
    })
    .join('\n\n---\n\n');
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
  console.log(`Ingesting PubMed abstracts for ${PUBMED_CONDITIONS.length} conditions (${MIN_YEAR}+)…`);

  let totalChunks = 0;
  let successConditions = 0;

  for (const condition of PUBMED_CONDITIONS) {
    const slug = `pubmed-${condition.slug}`;
    try {
      console.log(`- ${slug}`);
      const pmids = await searchPubMed(condition.term);
      if (!pmids.length) {
        console.warn(`  No PubMed results for "${condition.term}"`);
        continue;
      }

      const articles = await fetchPubMedArticles(pmids);
      if (!articles.length) {
        console.warn(`  No usable abstracts for ${condition.slug}`);
        continue;
      }

      const corpus = formatArticleCorpus(articles);
      const firstPmid = articles[0].pmid;
      const count = await storeKnowledge(supabase, openaiKey, {
        slug,
        title: `PubMed clinical reviews — ${condition.term}`,
        source_url: firstPmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${firstPmid}/`
          : 'https://pubmed.ncbi.nlm.nih.gov/',
        citation: `PubMed / NCBI — review articles and guidelines (${condition.term})`,
      }, corpus);

      console.log(`  stored ${count} chunks from ${articles.length} articles`);
      totalChunks += count;
      if (count > 0) successConditions += 1;
    } catch (e) {
      console.error(`  FAILED ${condition.slug}:`, e.message || e);
    }
  }

  const { count, error } = await supabase
    .from('medical_knowledge')
    .select('*', { count: 'exact', head: true })
    .like('topic_slug', 'pubmed-%');
  if (error) console.warn('Could not verify PubMed row count:', error.message);
  else {
    console.log(
      `\nDone. Conditions ingested: ${successConditions}/${PUBMED_CONDITIONS.length}, total PubMed chunks in DB: ${count ?? totalChunks}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
