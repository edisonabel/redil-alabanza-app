export interface SafeImageForCropperResult {
  blob: Blob;
  url: string;
}

/**
 * Reescala preventivamente una imagen a una dimensión segura antes de pasarla
 * al cropper. Esto reduce picos de RAM en WebViews/Android de gama baja.
 */
export async function getSafeImageForCropper(
  file: File,
  maxDimension = 1000,
): Promise<SafeImageForCropperResult> {
  return new Promise((resolve, reject) => {
    if (!(file instanceof File) || !file.type.startsWith('image/')) {
      reject(new Error('El archivo seleccionado no es una imagen válida.'));
      return;
    }

    const originalUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';

    const cleanupOriginalUrl = () => {
      URL.revokeObjectURL(originalUrl);
    };

    const cleanupImage = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };

    image.onerror = () => {
      cleanupOriginalUrl();
      cleanupImage();
      reject(new Error('No se pudo cargar la imagen seleccionada.'));
    };

    image.onload = () => {
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;

      if (!naturalWidth || !naturalHeight) {
        cleanupOriginalUrl();
        cleanupImage();
        reject(new Error('La imagen no tiene dimensiones válidas.'));
        return;
      }

      let width = naturalWidth;
      let height = naturalHeight;

      if (width > height && width > maxDimension) {
        height = Math.max(1, Math.round((height * maxDimension) / width));
        width = maxDimension;
      } else if (height >= width && height > maxDimension) {
        width = Math.max(1, Math.round((width * maxDimension) / height));
        height = maxDimension;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        cleanupOriginalUrl();
        cleanupImage();
        reject(new Error('No se pudo preparar el canvas de procesamiento.'));
        return;
      }

      ctx.drawImage(image, 0, 0, width, height);
      cleanupOriginalUrl();
      cleanupImage();

      canvas.toBlob(
        (blob) => {
          canvas.width = 0;
          canvas.height = 0;

          if (!blob) {
            reject(new Error('No se pudo generar una versión segura de la imagen.'));
            return;
          }

          const safeUrl = URL.createObjectURL(blob);
          resolve({ blob, url: safeUrl });
        },
        'image/jpeg',
        0.7,
      );
    };

    image.src = originalUrl;
  });
}
