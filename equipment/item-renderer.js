/* Ícones, dimensões de quadros LPC e recolorização de sprites. */
(function () {
  'use strict';
  const FRAME_SIZE = window.KTKEquipmentModules.data.FRAME_SIZE;
  function inferredFrameSize(image, preferredSize) {
    if (preferredSize) return preferredSize;
    // As armas LPC podem usar quadros de 64, 128 ou 192 px.
    // Os tamanhos fora do padrão são declarados no cadastro de cada item.
    return FRAME_SIZE;

  }

  function fitIcon(image, frameSize, staticFrame = null, maxSize = 50, staticRow = null) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = imageWidth;
    sourceCanvas.height = imageHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0);

    const columns = Math.max(1, Math.floor(imageWidth / frameSize));
    const rows = Math.max(1, Math.floor(imageHeight / frameSize));
    let chosen = null;
    let bestScore = 0;

    try {
      const firstRow = Number.isInteger(staticRow) ? Math.max(0, Math.min(rows - 1, staticRow)) : 0;
      const lastRow = Number.isInteger(staticRow) ? firstRow + 1 : rows;
      const firstColumn = Number.isInteger(staticFrame) ? Math.max(0, Math.min(columns - 1, staticFrame)) : 0;
      const lastColumn = Number.isInteger(staticFrame) ? firstColumn + 1 : columns;
      for (let row = firstRow; row < lastRow; row++) {
        for (let column = firstColumn; column < lastColumn; column++) {
          const pixels = sourceContext.getImageData(column * frameSize, row * frameSize, frameSize, frameSize).data;
          let minX = frameSize;
          let minY = frameSize;
          let maxX = -1;
          let maxY = -1;
          let count = 0;
          for (let y = 0; y < frameSize; y++) {
            for (let x = 0; x < frameSize; x++) {
              if (pixels[(y * frameSize + x) * 4 + 3] < 24) continue;
              count++;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          const boundsWidth = maxX - minX + 1;
          const boundsHeight = maxY - minY + 1;
          const score = count * Math.min(boundsWidth, boundsHeight);
          if (count && score > bestScore) {
            bestScore = score;
            chosen = { x: column * frameSize + minX, y: row * frameSize + minY, width: boundsWidth, height: boundsHeight };
          }
        }
      }
    } catch (error) {
      chosen = null;
    }

    const icon = document.createElement('canvas');
    icon.width = FRAME_SIZE;
    icon.height = FRAME_SIZE;
    const context = icon.getContext('2d');
    if (!chosen) {
      const column = Number.isInteger(staticFrame)
        ? Math.max(0, Math.min(columns - 1, staticFrame))
        : Math.floor(columns / 2);
      const row = Number.isInteger(staticRow)
        ? Math.max(0, Math.min(rows - 1, staticRow))
        : Math.min(2, rows - 1);
      const sourceX = column * frameSize;
      const sourceY = row * frameSize;
      const sourceWidth = Math.min(frameSize, imageWidth - sourceX);
      const sourceHeight = Math.min(frameSize, imageHeight - sourceY);
      const drawSize = Math.min(maxSize, FRAME_SIZE);
      const offset = (FRAME_SIZE - drawSize) / 2;
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, offset, offset, drawSize, drawSize);
      return icon;
    }

    const scale = Math.min(maxSize / chosen.width, maxSize / chosen.height);
    const width = chosen.width * scale;
    const height = chosen.height * scale;
    context.imageSmoothingEnabled = false;
    context.drawImage(
      image,
      chosen.x, chosen.y, chosen.width, chosen.height,
      (FRAME_SIZE - width) / 2, (FRAME_SIZE - height) / 2, width, height
    );
    return icon;
  }

  function createConfiguredIcon(image, config, item) {
    return fitIcon(image, item.iconFrameSize, config.iconStaticFrame, item.iconFillSize, config.iconStaticRow);
  }

  function tintPalette(hex) {
    const rgb = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16));
    return [0.32, 0.45, 0.60, 0.76, 0.92, 1.08].map(factor =>
      `#${rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel * factor))).toString(16).padStart(2, '0')).join('')}`
    );
  }

  function recolorItemSprite(image, mode) {
    const paletteHex = mode === 'black'
      ? ['#111111','#171717','#202020','#2b2b2b','#3b3b3b','#515151']
      : typeof mode === 'string' && /^#[0-9a-f]{6}$/i.test(mode) ? tintPalette(mode) : null;
    if (!paletteHex) return image;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    try {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const palette = paletteHex.map(color => color.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16)));
      for (let index = 0; index < pixels.data.length; index += 4) {
        if (pixels.data[index + 3] === 0) continue;
        const luminance = (pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114) / 255;
        const paletteIndex = Math.max(0, Math.min(5, Math.round(luminance * 5)));
        const rgb = palette[paletteIndex];
        pixels.data[index] = rgb[0];
        pixels.data[index + 1] = rgb[1];
        pixels.data[index + 2] = rgb[2];
      }
      context.putImageData(pixels, 0, 0);
      return canvas;
    } catch (error) {
      return image;
    }
  }
  window.KTKEquipmentModules.itemRenderer = {inferredFrameSize,fitIcon,createConfiguredIcon,tintPalette,recolorItemSprite};
})();
