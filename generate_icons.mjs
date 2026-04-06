import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT_DIR = 'C:/Users/edici/OneDrive/Documentos/ALABANZA';
const PNG_MASTER_PATH = path.join(ROOT_DIR, 'src/assets/icon-master.png');
const SVG_MASTER_PATH = path.join(ROOT_DIR, 'src/assets/favicon.svg');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const WHITE_BG = { r: 255, g: 255, b: 255, alpha: 1 };

const STANDARD_TARGETS = [
  { size: 16, filename: 'favicon-16.png', svgPadding: 2 },
  { size: 32, filename: 'favicon-32.png', svgPadding: 4 },
  { size: 64, filename: 'favicon-64.png', svgPadding: 8 },
  { size: 180, filename: 'apple-touch-icon.png', svgPadding: 22 },
  { size: 192, filename: 'icon-192.png', svgPadding: 24 },
  { size: 512, filename: 'icon-512.png', svgPadding: 64 },
];

const MASKABLE_TARGETS = [
  { size: 192, filename: 'icon-192-maskable.png', padding: 21 },
  { size: 512, filename: 'icon-512-maskable.png', padding: 56 },
];

const resolveMaster = () => {
  if (fs.existsSync(PNG_MASTER_PATH)) {
    return { type: 'png', sourcePath: PNG_MASTER_PATH };
  }

  if (fs.existsSync(SVG_MASTER_PATH)) {
    return { type: 'svg', sourcePath: SVG_MASTER_PATH };
  }

  throw new Error(
    `No se encontro una fuente valida. Usa ${PNG_MASTER_PATH} o ${SVG_MASTER_PATH}.`,
  );
};

const buildPngMasterBuffer = async (sourcePath) => sharp(sourcePath).png().toBuffer();

const buildSvgDerivedBuffer = async (sourcePath, innerSize) =>
  sharp(sourcePath)
    .resize(innerSize, innerSize, { fit: 'contain', background: WHITE_BG })
    .png()
    .toBuffer();

async function generateIcons() {
  const master = resolveMaster();
  console.log(`Usando fuente ${master.type.toUpperCase()}: ${master.sourcePath}`);

  if (master.type === 'png') {
    const masterBuffer = await buildPngMasterBuffer(master.sourcePath);

    for (const target of STANDARD_TARGETS) {
      await sharp(masterBuffer)
        .resize(target.size, target.size, { fit: 'cover' })
        .png()
        .toFile(path.join(PUBLIC_DIR, target.filename));
      console.log(`Generado ${target.filename} desde PNG maestro.`);
    }

    for (const target of MASKABLE_TARGETS) {
      const innerSize = target.size - target.padding * 2;
      const centeredBuffer = await sharp(masterBuffer)
        .resize(innerSize, innerSize, { fit: 'contain', background: WHITE_BG })
        .png()
        .toBuffer();

      await sharp({
        create: {
          width: target.size,
          height: target.size,
          channels: 4,
          background: WHITE_BG,
        },
      })
        .composite([{ input: centeredBuffer, gravity: 'center' }])
        .png()
        .toFile(path.join(PUBLIC_DIR, target.filename));
      console.log(`Generado ${target.filename} maskable desde PNG maestro.`);
    }

    return;
  }

  for (const target of STANDARD_TARGETS) {
    const sourceBuffer = await buildSvgDerivedBuffer(master.sourcePath, target.size - target.svgPadding * 2);
    await sharp({
      create: {
        width: target.size,
        height: target.size,
        channels: 4,
        background: WHITE_BG,
      },
    })
      .composite([{ input: sourceBuffer, gravity: 'center' }])
      .png()
      .toFile(path.join(PUBLIC_DIR, target.filename));
    console.log(`Generado ${target.filename} desde SVG maestro.`);
  }

  for (const target of MASKABLE_TARGETS) {
    const innerSize = target.size - target.padding * 2;
    const sourceBuffer = await buildSvgDerivedBuffer(master.sourcePath, innerSize);
    await sharp({
      create: {
        width: target.size,
        height: target.size,
        channels: 4,
        background: WHITE_BG,
      },
    })
      .composite([{ input: sourceBuffer, gravity: 'center' }])
      .png()
      .toFile(path.join(PUBLIC_DIR, target.filename));
    console.log(`Generado ${target.filename} maskable desde SVG maestro.`);
  }
}

generateIcons().catch((error) => {
  console.error('Error generando iconos:', error);
  process.exitCode = 1;
});
