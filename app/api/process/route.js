export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { parse } from 'node-html-parser';

async function fetchWithRetry(url, opts = {}, attempts = 3, backoffMs = 700) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

async function fetchText(url) {
  const res = await fetchWithRetry(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArticleVideo/1.0; +https://vercel.com)' }
  }, 2, 400);
  if (!res.ok) throw new Error(`Failed to fetch URL (status ${res.status})`);
  return await res.text();
}

function absolutizeUrl(base, rel) {
  try { return new URL(rel, base).toString(); } catch { return rel; }
}

function extractArticleAndImage(html, baseUrl) {
  const root = parse(html, { script: true, style: true, pre: true });
  let articleText = '';

  const articleEl = root.querySelector('article');
  if (articleEl) {
    articleEl.querySelectorAll('p').forEach((p) => {
      const t = p.text.trim(); if (t) articleText += t + '\n\n';
    });
  }
  if (!articleText) {
    const mainEl = root.querySelector('main');
    if (mainEl) {
      mainEl.querySelectorAll('p').forEach((p) => {
        const t = p.text.trim(); if (t) articleText += t + '\n\n';
      });
    }
  }
  if (!articleText) {
    const ps = root.querySelectorAll('p').map((p) => p.text.trim()).filter(Boolean);
    ps.sort((a, b) => b.length - a.length);
    articleText = ps.slice(0, 10).join('\n\n');
  }

  // image extraction
  let imageUrl = null;
  const metaOg = root.querySelector('meta[property="og:image"]') || root.querySelector('meta[name="og:image"]');
  if (metaOg) imageUrl = metaOg.getAttribute('content');
  if (!imageUrl) {
    const metaTw = root.querySelector('meta[name="twitter:image"]') || root.querySelector('meta[property="twitter:image"]');
    if (metaTw) imageUrl = metaTw.getAttribute('content');
  }
  if (!imageUrl) {
    const img = root.querySelector('img');
    if (img) {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src) imageUrl = absolutizeUrl(baseUrl, src);
    }
  }

  return { articleText: articleText.trim(), imageUrl: imageUrl ? imageUrl.trim() : null };
}

function extractiveSummarize(text, targetWords = 130) {
  const sents = text.replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sents.length === 0) return text.slice(0, 1000);
  const scores = sents.map((s, i) => ({ sent: s, score: s.length * (1 + Math.max(0, (sents.length - i) / sents.length) * 0.25) }));
  scores.sort((a, b) => b.score - a.score);
  const selected = [];
  let words = 0;
  for (const item of scores) {
    const wcount = item.sent.split(/\s+/).filter(Boolean).length;
    if (words + wcount <= targetWords || selected.length === 0) {
      selected.push(item.sent);
      words += wcount;
    }
    if (words >= targetWords) break;
  }
  selected.sort((a, b) => text.indexOf(a) - text.indexOf(b));
  return selected.join(' ');
}

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

    const html = await fetchText(url);
    const { articleText, imageUrl: scrapedImage } = extractArticleAndImage(html, url);

    if (!articleText || articleText.length < 120) {
      return NextResponse.json({ error: 'Failed to extract article text or article too short.' }, { status: 422 });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
    const maxAllowed = Number(process.env.NEXT_PUBLIC_MAX_DURATION || 90);

    // Summarize via OpenAI if available
    let summary = null;
    let usedOpenAI = false;
    if (OPENAI_API_KEY) {
      try {
        const prompt = `You are a professional narrator. Convert the following article into a concise, engaging spoken narration suitable for a short video. Keep spoken output around 60-90 seconds (approx 110-150 words). Remove ads and irrelevant parts. Produce a single plain text paragraph ready for TTS.

Article:
${articleText}
`;
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'system', content: 'You are a concise, professional summarizer.' }, { role: 'user', content: prompt }],
            max_tokens: 480,
            temperature: 0.6
          })
        });
        if (res.ok) {
          const j = await res.json();
          summary = j?.choices?.[0]?.message?.content?.trim();
          usedOpenAI = true;
        } else {
          console.warn('OpenAI summarize failed', await res.text());
        }
      } catch (err) {
        console.warn('OpenAI call error', err?.message || err);
      }
    }
    if (!summary) summary = extractiveSummarize(articleText, 130);

    const words = summary.split(/\s+/).filter(Boolean).length;
    const estimatedDurationSec = Math.min((words / 150) * 60, maxAllowed);

    // Resolve image URL or fallback to Unsplash
    let finalImageUrl = scrapedImage || null;
    if (!finalImageUrl) {
      const keywords = summary.split(/\s+/).filter(Boolean).slice(0, 6).join(',');
      finalImageUrl = `https://source.unsplash.com/1280x720/?${encodeURIComponent(keywords)}`;
    }

    // TTS via ElevenLabs (attempt)
    let audioBase64 = null;
    let audioFormat = null;
    let ttsFallback = false;
    if (ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID) {
      try {
        const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
            Accept: 'audio/mpeg'
          },
          body: JSON.stringify({
            text: summary,
            model: 'eleven_monolingual_v1',
            voice_settings: { stability: 0.6, similarity_boost: 0.6 }
          })
        });
        if (ttsRes.ok) {
          const ab = await ttsRes.arrayBuffer();
          audioBase64 = Buffer.from(ab).toString('base64');
          const ct = ttsRes.headers.get('content-type') || 'audio/mpeg';
          audioFormat = ct.includes('wav') ? 'wav' : ct.includes('mp3') || ct.includes('mpeg') ? 'mp3' : 'mp3';
        } else {
          console.warn('TTS failed', await ttsRes.text());
          ttsFallback = true;
        }
      } catch (err) {
        console.warn('TTS error', err?.message || err);
        ttsFallback = true;
      }
    } else {
      ttsFallback = true;
    }

    return NextResponse.json({
      summary,
      audioBase64,
      audioFormat,
      estimatedDurationSec,
      usedOpenAI,
      ttsFallback,
      imageUrl: finalImageUrl
    }, { status: 200 });
  } catch (err) {
    console.error('API/process error:', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
