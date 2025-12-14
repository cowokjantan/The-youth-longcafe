import './globals.css';
export const metadata = {
  title: 'Article → Short Video',
  description: 'Scrape article, summarize, TTS, create MP4 client-side with FFmpeg WASM.'
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <main style={{ fontFamily: 'Inter, system-ui, Arial', padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
