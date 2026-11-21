export type PdfZoom = 'fit' | number;
/** Keep display zoom independent from a strictly bounded backing bitmap. */
export function pdfRenderSizing(pageWidth: number, pageHeight: number, containerWidth: number, zoom: PdfZoom, devicePixelRatio: number) {
    if (![pageWidth, pageHeight, containerWidth].every(value => Number.isFinite(value) && value > 0))
        return null;
    const scale = zoom === 'fit' ? Math.min(containerWidth / pageWidth, 3) : Math.max(0.25, Math.min(Number.isFinite(zoom) ? zoom : 1, 3));
    const cssWidth = pageWidth * scale;
    const cssHeight = pageHeight * scale;
    const area = cssWidth * cssHeight;
    if (![cssWidth, cssHeight, area].every(value => Number.isFinite(value) && value > 0))
        return null;
    const density = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio, 2) : 1;
    const rasterScale = Math.min(density, 3200 / cssWidth, 3200 / cssHeight, Math.sqrt(10240000 / area));
    return { cssWidth, cssHeight, scale, rasterScale, pixelWidth: Math.max(1, Math.floor(cssWidth * rasterScale)), pixelHeight: Math.max(1, Math.floor(cssHeight * rasterScale)) };
}
