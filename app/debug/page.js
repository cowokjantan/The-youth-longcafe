'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const VideoCreatorClient = dynamic(() => import('../../components/VideoCreatorClient'), { ssr: false });

export default function DebugPage() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/debug-tone');
        if (!res.ok) throw new Error('Debug audio fetch failed: ' + res.status);
        const j = await res.json();
        setPayload(j);
      } catch (err) {
        console.error('Debug fetch error', err);
        setError(String(err.message || err));
      }
    })();
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: '24px auto', padding: 12 }}>
      <div style={{ background: '#fff', padding: 18, borderRadius: 10 }}>
        <h2>Debug: Auto-create video from server-generated test audio</h2>
        <p>This page fetches a short WAV tone from the server and passes it to VideoCreatorClient (auto-create test).</p>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {!payload && !error && <p>Loading test audio...</p>}
        {payload && (
          <div style={{ marginTop: 12 }}>
            <VideoCreatorClient
              audioBase64={payload.audioBase64}
              audioFormat={payload.audioFormat}
              summary={payload.summary}
              ttsFallback={payload.ttsFallback}
              imageUrl={payload.imageUrl}
            />
          </div>
        )}
      </div>
    </div>
  );
}
