import sharp from 'sharp';

// Keep the long edge modest so the vision tower fits in GPU memory next to the language model.
const MAX_EDGE = Number(process.env.IDMEME_IMAGE_EDGE) || 768;

export async function prepareImageForModel(imagePath: string): Promise<{ mime: 'image/jpeg'; base64: string }> {
  try {
    const image = sharp(imagePath, {
      animated: false,
      limitInputPixels: 40_000_000,
      failOn: 'error'
    });
    const buf = await image
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    if (!buf.length) throw new Error('encoder returned an empty file');
    return { mime: 'image/jpeg', base64: buf.toString('base64') };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read image: ${message}`);
  }
}
