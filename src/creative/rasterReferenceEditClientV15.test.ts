import { describe, expect, it } from 'vitest';
import {
  RASTER_REFERENCE_MAX_BYTES_V15,
  decodedRasterDataUrlBytesV15,
  rasterReferenceTargetSizeV15,
} from './rasterReferenceEditClientV15';

describe('rasterReferenceEditClientV15', () => {
  it('bounds the longest reference edge below the server 512px boundary', () => {
    expect(rasterReferenceTargetSizeV15(1024, 1024)).toEqual({ width: 511, height: 511 });
    expect(rasterReferenceTargetSizeV15(1536, 864)).toEqual({ width: 511, height: 287 });
    expect(rasterReferenceTargetSizeV15(864, 1536)).toEqual({ width: 287, height: 511 });
  });

  it('does not upscale already-small references', () => {
    expect(rasterReferenceTargetSizeV15(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it('calculates decoded byte length for bounded image data URLs', () => {
    expect(decodedRasterDataUrlBytesV15('data:image/webp;base64,QUJDRA==')).toBe(4);
    expect(decodedRasterDataUrlBytesV15('data:image/jpeg;base64,QUJD')).toBe(3);
    expect(RASTER_REFERENCE_MAX_BYTES_V15).toBe(768 * 1024);
  });

  it('rejects unsupported data URLs instead of guessing their size', () => {
    expect(() => decodedRasterDataUrlBytesV15('https://example.com/image.png')).toThrow('REFERENCE_IMAGE_CLIENT_DATA_URL_INVALID');
    expect(() => decodedRasterDataUrlBytesV15('data:image/png;base64,QUJDRA==')).toThrow('REFERENCE_IMAGE_CLIENT_DATA_URL_INVALID');
  });
});
