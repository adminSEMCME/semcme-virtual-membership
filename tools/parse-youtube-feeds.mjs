import { readFileSync } from 'node:fs';

const ids = [
  'PLRSo5uXl0WzWi76-SRQfDF7AVY5JT5XTD',
  'PLRSo5uXl0WzUe2QpGjL3VWKYlqy34xMs-',
  'PLRSo5uXl0WzWsHLxCGwJ4zOSNOeBQ6Gh0',
  'PLRSo5uXl0WzXvpJk_R00QYfb7qpUWfK_H',
  'PLRSo5uXl0WzWo9_rWLmr26A0iNaO30e6s',
  'PLRSo5uXl0WzVLe6VgIL3tLS7c7VXkqKIR',
  'PLRSo5uXl0WzWNuKxAPsg7a6Y0bSJDHOJY',
  'PLRSo5uXl0WzUYxKMJ6g444ebK387tWlZ2',
  'PLRSo5uXl0WzW3g27334GwCEpSxlwBqONA',
  'PLRSo5uXl0WzWZBaXLh-3SFeFXZ_acxR16',
  'PLRSo5uXl0WzXBKTccxMAMoEh5bCRBHIww',
];

const decode = (value = '') =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const parsed = {};

ids.forEach((id, index) => {
  const file = `/tmp/semcme-pl-${String(index + 1).padStart(2, '0')}.xml`;
  const xml = readFileSync(file, 'utf8');
  const playlistTitle = decode(xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1];
    const videoId = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1] || '';
    return {
      title: decode(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]),
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }).reverse();
  parsed[id] = { playlistTitle, videos };
});

console.log(JSON.stringify(parsed, null, 2));
