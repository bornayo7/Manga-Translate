export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_IMAGE_DIMENSION = 16_384;

export function validateImageDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('Resize this image to at most 16 megapixels and 16,384 pixels on either side.');
  }
}

export function validateImageFile(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && !(!file.type && /\.(jpe?g|png|webp)$/i.test(file.name))) {
    throw new Error('Choose a JPG, PNG, or WEBP image.');
  }
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('Choose an image between 1 byte and 10 MB.');
}

export function readImageBase64(file: File, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => { reader.abort(); cleanup(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => { cleanup(); resolve(String(reader.result).split(',')[1]); };
    reader.onerror = () => { cleanup(); reject(new Error('The image file could not be read.')); };
    reader.readAsDataURL(file);
  });
}

export function loadImage(file: File, signal?: AbortSignal): Promise<HTMLImageElement> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => { URL.revokeObjectURL(url); signal?.removeEventListener('abort', abort); image.onload = null; image.onerror = null; };
    const abort = () => { cleanup(); image.src = ''; reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => {
      cleanup();
      try {
        validateImageDimensions(image.naturalWidth, image.naturalHeight);
        resolve(image);
      } catch (error) {
        image.src = '';
        reject(error);
      }
    };
    image.onerror = () => { cleanup(); reject(new Error('This image could not be decoded. Choose another JPG, PNG, or WEBP.')); };
    image.src = url;
  });
}
