import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);

const findInitialData = (html) => {
  const marker = 'var ytInitialData = ';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start + marker.length, i + 1));
    }
  }
  return null;
};

const textFromRuns = (value) => {
  if (!value) return '';
  if (value.simpleText) return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || '').join('');
  return '';
};

const collect = (value, videos = []) => {
  if (!value || typeof value !== 'object') return videos;
  if (value.playlistVideoRenderer) {
    const item = value.playlistVideoRenderer;
    if (item.videoId && item.isPlayable !== false) {
      videos.push({
        title: textFromRuns(item.title),
        url: `https://www.youtube.com/watch?v=${item.videoId}`,
      });
    }
  }
  if (value.lockupViewModel) {
    const item = value.lockupViewModel;
    const title = item.metadata?.lockupMetadataViewModel?.title?.content || '';
    const thumbnail = item.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url || '';
    const videoId =
      thumbnail.match(/\/vi\/([^/]+)\//)?.[1] ||
      JSON.stringify(item).match(/"videoId":"([^"]+)"/)?.[1] ||
      JSON.stringify(item).match(/"animationActivationTargetId":"([^"]+)"/)?.[1] ||
      '';
    if (videoId && title) {
      videos.push({
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
  }
  if (Array.isArray(value)) value.forEach((item) => collect(item, videos));
  else Object.values(value).forEach((item) => collect(item, videos));
  return videos;
};

const output = {};

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const data = findInitialData(html);
  const videos = collect(data)
    .filter((video, index, all) => video.title && all.findIndex((x) => x.url === video.url) === index)
    .reverse();
  output[file] = videos;
}

console.log(JSON.stringify(output, null, 2));
