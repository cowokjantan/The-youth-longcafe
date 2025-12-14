'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';

// client-only heavy component
const VideoCreatorClient = dynamic(() => import('../components/VideoCreatorClient'), { ssr: false });

export default function Page() {
  const [url, setUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);

  async function handleFetch(e) {
    e.preventDefault();
    setError(null);
    if (!url) { setError('Masukkan URL artikel dulu.'); return; }
    setProcessing(true);
    setPayload(null);
    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Server error');
      }
      const data = await res.json();
      setPayload(data);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Article → Short Video</h1>
        <p>Masukkan URL artikel. Server scrape & ringkas, server coba TTS. Browser bikin MP4 (client-side).</p>

        <form onSubmit={handleFetch} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd' }}
          />
          <button disabled={processing} style={{ padding: '10px 14px', borderRadius: 8 }}>
            {processing ? 'Mengambil...' : 'Proses'}
          </button>
        </form>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </div>

      {payload && (
        <div style={{ marginTop: 18 }}>
          <div className="card">
            <h3>Ringkasan (AI{payload.usedOpenAI ? '' : ' — fallback'})</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{payload.summary}</p>
            <p style={{ fontSize: 13, color: '#666' }}>Perkiraan durasi: {Number(payload.estimatedDurationSec).toFixed(1)}s</p>

            <VideoCreatorClient
              audioBase64={payload.audioBase64}
              audioFormat={payload.audioFormat}
              summary={payload.summary}
              ttsFallback={payload.ttsFallback}
              imageUrl={payload.imageUrl}
            />
          </div>
        </div>
      )}
    </div>
  );
}
