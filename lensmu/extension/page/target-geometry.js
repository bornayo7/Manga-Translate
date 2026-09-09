// Canvas coordinates belong to the containing block, while OCR coordinates
// belong to source pixels. Account for borders, padding and ancestor scaling.
export function readTargetGeometry(target, anchor, window) {
  const rect = target.getBoundingClientRect(), parent = anchor.getBoundingClientRect();
  const style = window.getComputedStyle(target);
  const ax = parent.width / (anchor.offsetWidth || parent.width) || 1;
  const ay = parent.height / (anchor.offsetHeight || parent.height) || 1;
  const width = rect.width / ax, height = rect.height / ay;
  const sx = width / (target.offsetWidth || width) || 1;
  const sy = height / (target.offsetHeight || height) || 1;
  const background = !['IMG', 'CANVAS'].includes(target.tagName);
  const origin = background ? style.backgroundOrigin || 'padding-box' : 'content-box';
  const inset = (side, scale) => scale * ((origin === 'border-box' ? 0 : parseFloat(style[`border${side}Width`]) || 0) +
    (origin === 'content-box' ? parseFloat(style[`padding${side}`]) || 0 : 0));
  const left = inset('Left', sx), top = inset('Top', sy);
  const imagePlacement = background
    ? { fit: ['cover', 'contain'].includes(style.backgroundSize) ? style.backgroundSize : 'none',
      size: ['cover', 'contain'].includes(style.backgroundSize) ? undefined : style.backgroundSize || 'auto',
      position: style.backgroundPosition || '0% 0%' }
    : { fit: style.objectFit || 'fill', position: style.objectPosition || '50% 50%' };
  return {
    left: (rect.left - parent.left) / ax - (anchor.clientLeft || 0) + left,
    top: (rect.top - parent.top) / ay - (anchor.clientTop || 0) + top,
    width: Math.max(0, width - left - inset('Right', sx)),
    height: Math.max(0, height - top - inset('Bottom', sy)),
    dpr: window.devicePixelRatio || 1,
    imagePlacement
  };
}
