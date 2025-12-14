'use client';

import React, { useEffect, useRef, useState } from 'react';

/*
Client component:
- Auto-create MP4 when server provided audioBase64
- Fallback: record browser TTS (user gesture) and create MP4
- Uses dynamic import of @ffmpeg/ffmpeg and supports self-hosted core in /public or NEXT_PUBLIC_FFMPEG_CORE_PATH
*/

export default function VideoCreatorClient({ audioBase64, audioFormat, summary, ttsFallback, imageUrl }) {
  const [status, setStatus] = useState(null);
  const [progressPct, setProgressPct] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const ffmpegRef = useRef(null);
  const loadingRef = useRef(false);
  const autoStartedRef = useRef(false);

  const MAX_DURATION = Number(process.env.NEXT_PUBLIC_MAX_DURATION || 90);

  async function dynamicImportFFmpegModule() {
    // avoid bundler static analysis
    // eslint-disable-next-line no-new-func
    return new Function('return import("@ffmpeg/ffmpeg")')();
  }

  async function ensureFFmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (loadingRef.current) {
      while (loadingRef.current && !ffmpegRef.current) await new Promise((r) => setTimeout(r, 100));
      return ffmpegRef.current;
    }
    loadingRef.current = true;
    setStatus('Memuat FFmpeg (client)...');
    setProgressPct(5);

    try {
      const ffmpegModule = await dynamicImportFFmpegModule();
      const { createFFmpeg, fetchFile } = ffmpegModule;

      // choose core path: env var -> /ffmpeg-core.js -> unpkg fallback
      const envCore = typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_FFMPEG_CORE_PATH;
      let corePath = envCore || '/ffmpeg-core.js';
      try {
        // verify local
        const h = await fetch(corePath, { method: 'HEAD' });
        if (!h.ok && !envCore) corePath = 'https://unpkg.com/@ffmpeg/core@0.11.6/dist/ffmpeg-core.js';
      } catch {
        corePath = 'https://unpkg.com/@ffmpeg/core@0.11.6/dist/ffmpeg-core.js';
      }

      const ffmpeg = createFFmpeg({
        log: true,
        corePath,
        progress: (p) => {
          if (p && p.ratio) setProgressPct(Math.min(100, Math.round(p.ratio * 100)));
        }
      });
      await ffmpeg.load();
      ffmpegRef.current = { ffmpeg, fetchFile, corePath };
      setStatus('FFmpeg siap.');
      setProgressPct(10);
      return ffmpegRef.current;
    } catch (err) {
      setStatus('Gagal memuat FFmpeg: ' + String(err));
      setProgressPct(0);
      loadingRef.current = false;
      throw err;
    } finally {
      loadingRef.current = false;
    }
  }

  function base64ToBlob(base64, mime = 'audio/mpeg') {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function estimateDurationFromAudio(_data, format) {
    try {
      const bytes = _data.length;
      if (format === 'mp3' || format === 'mpeg') return (bytes * 8) / 192000;
      if (format === 'wav') {
        if (bytes > 44) {
          const view = new DataView(_data.buffer);
          const byteRate = view.getUint32(28, true);
          if (byteRate > 0) return (bytes - 44) / byteRate;
        }
        return bytes / 176400;
      }
      return (bytes * 8) / 192000;
    } catch {
      return 60;
    }
  }

  async function fetchImageAsUint8(url) {
    setStatus('Mengambil gambar...');
    setProgressPct(12);
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('Gagal fetch gambar: ' + res.status);
      const ab = await res.arrayBuffer();
      return new Uint8Array(ab);
    } catch (err) {
      console.warn('fetchImage failed', err);
      return null;
    }
  }

  async function makeVideoFromAudioAndImage(audioBlobOrUint8, audioFmt = 'mp3', imgUrl = null) {
    setStatus('Menyiapkan FFmpeg...');
    setProgressPct(10);
    const ctx = await ensureFFmpeg();
    const { ffmpeg, fetchFile } = ctx;

    setStatus('Menulis audio ke ffmpeg...');
    setProgressPct(20);

    let audioName = `input_audio.${audioFmt}`;
    try {
      const ffFile = await fetchFile(audioBlobOrUint8 instanceof Blob ? audioBlobOrUint8 : new Blob([audioBlobOrUint8]), {});
      ffmpeg.FS('writeFile', audioName, ffFile);
    } catch (err) {
      try { ffmpeg.FS('writeFile', audioName, audioBlobOrUint8); }
      catch (e) { throw new Error('Gagal menulis audio ke FS: ' + e); }
    }

    let imgWritten = false;
    if (imgUrl) {
      setStatus('Mengunduh gambar untuk thumbnail...');
      setProgressPct(30);
      const imgData = await fetchImageAsUint8(imgUrl);
      if (imgData) {
        const ext = '.jpg';
        try {
          ffmpeg.FS('writeFile', 'thumb' + ext, imgData);
          imgWritten = true;
          try {
            await ffmpeg.run('-i', 'thumb' + ext, '-vf', 'scale=1280:720', '-y', 'thumb.png');
            try { ffmpeg.FS('unlink', 'thumb' + ext); } catch {}
          } catch (e) { console.warn('image convert failed', e); }
        } catch (e) { console.warn('writeFile image failed', e); }
      }
    }

    if (!imgWritten) {
      setStatus('Menggunakan thumbnail default (SVG)...');
      setProgressPct(40);
      const svgResp = await fetch('/thumbnail.svg');
      const svgText = await svgResp.text();
      ffmpeg.FS('writeFile', 'thumb.svg', new TextEncoder().encode(svgText));
      try {
        await ffmpeg.run('-i', 'thumb.svg', '-vf', 'scale=1280:720', '-y', 'thumb.png');
      } catch (e) {}
    }

    setStatus('Membuat MP4...');
    setProgressPct(50);
    const durationEstimate = Math.min(Math.ceil(estimateDurationFromAudio(audioBlobOrUint8 instanceof Blob ? new Uint8Array(await audioBlobOrUint8.arrayBuffer()) : audioBlobOrUint8, audioFmt)), MAX_DURATION);

    try {
      await ffmpeg.run(
        '-loop', '1',
        '-i', 'thumb.png',
        '-i', audioName,
        '-c:v', 'libx264',
        '-t', String(durationEstimate),
        '-vf', 'scale=1280:720',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        'output.mp4'
      );
    } catch (err) {
      console.warn('libx264 failed, try mpeg4', err);
      try {
        await ffmpeg.run(
          '-loop', '1',
          '-i', 'thumb.png',
          '-i', audioName,
          '-c:v', 'mpeg4',
          '-t', String(durationEstimate),
          '-vf', 'scale=1280:720',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          'output.mp4'
        );
      } catch (e) {
        throw new Error('FFmpeg encoding failed: ' + e);
      }
    }

    setProgressPct(90);
    setStatus('Membaca hasil video...');
    const out = ffmpeg.FS('readFile', 'output.mp4');
    const blob = new Blob([out.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    setVideoUrl(url);
    setStatus('Selesai — unduh video di bawah');
    setProgressPct(100);

    try { ffmpeg.FS('unlink', audioName); } catch {}
    try { ffmpeg.FS('unlink', 'thumb.png'); } catch {}
    try { ffmpeg.FS('unlink', 'output.mp4'); } catch {}
  }

  useEffect(() => {
    if (audioBase64 && !autoStartedRef.current) {
      autoStartedRef.current = true;
      (async () => {
        setStatus('Audio server tersedia, memulai pembuatan video otomatis...');
        try {
          const mime = audioFormat && audioFormat.includes('wav') ? 'audio/wav' : 'audio/mpeg';
          const audioBlob = base64ToBlob(audioBase64, mime);
          await makeVideoFromAudioAndImage(audioBlob, audioFormat || (mime.includes('wav') ? 'wav' : 'mp3'), imageUrl);
        } catch (err) {
          console.error('Auto video creation failed', err);
          setStatus('Auto pembuatan video gagal: ' + String(err));
        }
      })();
    }
  }, [audioBase64, imageUrl]);

  async function recordBrowserTTSAndMakeVideo() {
    if (!summary) { setStatus('Tidak ada ringkasan.'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { setStatus('Browser tidak mendukung capture tab audio.'); return; }

    setStatus('Meminta izin capture tab audio (browser dialog)...');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.start();
      const utter = new SpeechSynthesisUtterance(summary);
      speechSynthesis.speak(utter);
      let ended = false;
      utter.onend = () => {
        ended = true;
        try { recorder.stop(); } catch {}
      };
      const wordCount = summary.split(/\s+/).filter(Boolean).length;
      const estMs = Math.min((wordCount / 150) * 60000 + 2000, MAX_DURATION * 1000 + 5000);
      const forcedTimer = setTimeout(() => { if (!ended) { try { recorder.state !== 'inactive' && recorder.stop(); } catch {} } }, estMs);
      await new Promise((res) => { recorder.onstop = res; });
      clearTimeout(forcedTimer);
      const audioBlob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      stream.getTracks().forEach((t) => t.stop());
      setStatus('Rekaman selesai, konversi dengan FFmpeg...');
      await makeVideoFromAudioAndImage(audioBlob, 'webm', imageUrl);
    } catch (err) {
      console.error('record fallback error', err);
      setStatus('Rekaman TTS browser gagal: ' + String(err));
    }
  }

  function playBrowserTTS() {
    if (!summary) return;
    const utter = new SpeechSynthesisUtterance(summary);
    speechSynthesis.speak(utter);
  }

  function downloadTranscript() {
    const blob = new Blob([summary || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'summary.txt'; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <button onClick={async () => {
          if (!audioBase64) { setStatus('Tidak ada audio server. Gunakan fallback browser TTS.'); return; }
          setStatus('Memulai pembuatan video (manual)...');
          try {
            const mime = audioFormat && audioFormat.includes('wav') ? 'audio/wav' : 'audio/mpeg';
            const audioBlob = base64ToBlob(audioBase64, mime);
            await makeVideoFromAudioAndImage(audioBlob, audioFormat || (mime.includes('wav') ? 'wav' : 'mp3'), imageUrl);
          } catch (err) {
            console.error('Manual make failed', err);
            setStatus('Gagal membuat video (manual): ' + String(err));
          }
        }}>Buat Video MP4 (dari audio server)</button>

        {videoUrl && <a href={videoUrl} download="article_video.mp4" style={{ padding:'8px' }}>Unduh MP4</a>}

        {(!audioBase64 && ttsFallback) && (
          <>
            <button onClick={recordBrowserTTSAndMakeVideo}>Rekam TTS di Browser & Buat Video</button>
            <button onClick={playBrowserTTS}>Putar dengan Browser TTS</button>
            <button onClick={downloadTranscript}>Unduh Transkrip</button>
          </>
        )}
      </div>

      <div style={{ marginTop:12 }}>
        <div className="progress" style={{ width: 300 }}>
          <div style={{ width: `${progressPct}%` }} />
        </div>
        <p style={{ marginTop:8 }}>{status}</p>
        {videoUrl && <video src={videoUrl} controls style={{ maxWidth:'100%', marginTop:12 }} />}
      </div>
    </div>
  );
}
