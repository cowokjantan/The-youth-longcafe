export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

/**
 * Generate a short WAV tone (server) for client debug/testing.
 */
function generateToneWavBase64(durationSec = 3, freq = 440, sampleRate = 44100, volume = 0.6) {
  const samples = Math.floor(durationSec * sampleRate);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample * 1;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  function writeString(s) { for (let i = 0; i < s.length; i++) { view.setUint8(offset, s.charCodeAt(i)); offset++; } }
  function writeUint32(v) { view.setUint32(offset, v, true); offset += 4; }
  function writeUint16(v) { view.setUint16(offset, v, true); offset += 2; }
  writeString('RIFF'); writeUint32(36 + dataSize); writeString('WAVE');
  writeString('fmt '); writeUint32(16); writeUint16(1); writeUint16(1); writeUint32(sampleRate);
  writeUint32(byteRate); writeUint16(blockAlign); writeUint16(16);
  writeString('data'); writeUint32(dataSize);
  const maxAmp = Math.floor(32767 * volume);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(maxAmp * Math.sin(2 * Math.PI * freq * t));
    view.setInt16(offset, sample, true);
    offset += 2;
  }
  const uint8 = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

export async function GET() {
  try {
    const duration = 3;
    const base64 = generateToneWavBase64(duration, 440, 44100, 0.6);
    const payload = {
      summary: 'Debug tone audio (3s 440Hz) — for testing.',
      audioBase64: base64,
      audioFormat: 'wav',
      estimatedDurationSec: duration,
      usedOpenAI: false,
      ttsFallback: false,
      imageUrl: '/thumbnail.svg'
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
