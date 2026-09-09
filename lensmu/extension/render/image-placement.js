// Maps source pixels into a CSS content box. Both sampling and text geometry
// must use this transform; independently stretching either misplaces text.
export function resolveImagePlacement({ width, height, naturalWidth, naturalHeight, fit = 'fill', position = '50% 50%', size }) {
  if (![width, height, naturalWidth, naturalHeight].every((n) => Number.isFinite(n) && n > 0)) return null;
  let scaleX = width / naturalWidth, scaleY = height / naturalHeight;
  if (fit !== 'fill') {
    let scale;
    if (fit === 'contain') scale = Math.min(scaleX, scaleY);
    else if (fit === 'cover') scale = Math.max(scaleX, scaleY);
    else if (fit === 'none') scale = 1;
    else if (fit === 'scale-down') scale = Math.min(1, scaleX, scaleY);
    else return null;
    scaleX = scaleY = scale;
  }
  if (size) {
    const dimensions = String(size).trim().split(/\s+/);
    if (dimensions.length === 1) dimensions.push('auto');
    const length = (text, basis) => text === 'auto' ? null : /^\d*\.?\d+(?:px|%)?$/.test(text)
      ? parseFloat(text) * (text.endsWith('%') ? basis / 100 : 1) : NaN;
    let w = length(dimensions[0], width), h = length(dimensions[1], height);
    if (dimensions.length !== 2 || Number.isNaN(w) || Number.isNaN(h)) return null;
    if (w === null && h === null) { w = naturalWidth; h = naturalHeight; }
    else if (w === null) w = h * naturalWidth / naturalHeight;
    else if (h === null) h = w * naturalHeight / naturalWidth;
    scaleX = w / naturalWidth; scaleY = h / naturalHeight;
    if (!(scaleX > 0 && scaleY > 0)) return null;
  }
  const tokens = String(position).trim().split(/\s+/);
  if (tokens.length === 1) tokens.push('50%');
  if (['top', 'bottom'].includes(tokens[0])) tokens.reverse();
  if (tokens.length !== 2) return null;
  function offset(value, remaining) {
    const keyword = { left: 0, top: 0, center: .5, right: 1, bottom: 1 }[value];
    if (keyword !== undefined) return remaining * keyword;
    if (/^-?[\d.]+%$/.test(value)) return remaining * parseFloat(value) / 100;
    if (/^-?[\d.]+(?:px)?$/.test(value)) return parseFloat(value);
    return NaN;
  }
  const drawnWidth = naturalWidth * scaleX, drawnHeight = naturalHeight * scaleY;
  const x = offset(tokens[0], width - drawnWidth), y = offset(tokens[1], height - drawnHeight);
  if (![x, y].every(Number.isFinite)) return null;
  const left = Math.max(0, x), top = Math.max(0, y);
  const visible = { x: left, y: top, width: Math.min(width, x + drawnWidth) - left, height: Math.min(height, y + drawnHeight) - top };
  return { x, y, width: drawnWidth, height: drawnHeight, scaleX, scaleY, visible };
}
