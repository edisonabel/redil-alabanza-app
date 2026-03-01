import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svgPath = 'c:/Users/edici/OneDrive/Documentos/ALABANZA/src/assets/favicon.svg';
const publicDir = 'c:/Users/edici/OneDrive/Documentos/ALABANZA/public';

async function generateIcons() {
    try {
        if (!fs.existsSync(svgPath)) {
            console.error('No se encontro el archivo SVG:', svgPath);
            return;
        }

        const buffer = fs.readFileSync(svgPath);

        const generateIcon = async (size, padding, filename) => {
            const innerSize = size - (padding * 2);
            const outputPath = path.join(publicDir, filename);

            await sharp({
                create: {
                    width: size,
                    height: size,
                    channels: 4,
                    background: { r: 255, g: 255, b: 255, alpha: 1 } // Fondo Blanco
                }
            })
                .composite([
                    {
                        input: await sharp(buffer).resize(innerSize, innerSize, { fit: 'contain' }).toBuffer(),
                        gravity: 'center'
                    }
                ])
                .png()
                .toFile(outputPath);

            console.log(`Generado ${filename} con fondo blanco y padding.`);
        };

        // 192x192 (Android) - aprox 12% padding (24px por lado)
        await generateIcon(192, 24, 'icon-192.png');

        // 512x512 (Android High Res) - aprox 12% padding (64px por lado)
        await generateIcon(512, 64, 'icon-512.png');

        // Apple Touch Icon (180x180) - aprox 12% padding (22px por lado)
        await generateIcon(180, 22, 'apple-touch-icon.png');

    } catch (error) {
        console.error('Error generando iconos:', error);
    }
}

generateIcons();
