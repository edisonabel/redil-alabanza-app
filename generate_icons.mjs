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

        // 192x192
        await sharp(buffer)
            .resize(192, 192)
            .png()
            .toFile(path.join(publicDir, 'icon-192.png'));
        console.log('Generado icon-192.png');

        // 512x512
        await sharp(buffer)
            .resize(512, 512)
            .png()
            .toFile(path.join(publicDir, 'icon-512.png'));
        console.log('Generado icon-512.png');

        // Apple Touch Icon (180x180 standard)
        await sharp(buffer)
            .resize(180, 180)
            .png()
            .toFile(path.join(publicDir, 'apple-touch-icon.png'));
        console.log('Generado apple-touch-icon.png');

    } catch (error) {
        console.error('Error generando iconos:', error);
    }
}

generateIcons();
