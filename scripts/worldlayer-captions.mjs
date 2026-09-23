export function captionedFilename(filename) {
  return `${filename}-captioned.mp4`;
}

function timestamp(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const secs = Math.floor(milliseconds / 1000) % 60;
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function captionsToSrt(captions) {
  return captions
    .map(
      (caption, index) =>
        `${index + 1}\n${timestamp(caption.start)} --> ${timestamp(caption.end)}\n${caption.text.trim()}\n`,
    )
    .join('\n');
}
