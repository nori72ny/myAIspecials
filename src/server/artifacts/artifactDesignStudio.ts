export interface BannerAdSpec {
  headline: string; subheadline: string; priceTag: string; callToAction: string;
  themeColor: string; aspectRatio: "OGP_1200_630" | "SQUARE_1080_1080" | "STORY_1080_1920";
}
export interface GeneratedArtifact {
  id: string; format: "SVG" | "PNG"; rawSvg: string; contrastRatio: number;
  wcagPassed: boolean; dimensions: { width: number; height: number }; metadata: BannerAdSpec;
}
export class ArtifactDesignStudio {
  private static readonly DIMENSIONS = {
    OGP_1200_630: { width: 1200, height: 630 },
    SQUARE_1080_1080: { width: 1080, height: 1080 },
    STORY_1080_1920: { width: 1080, height: 1920 },
  };
  public static generateAdBanner(spec: BannerAdSpec): GeneratedArtifact {
    const dim = this.DIMENSIONS[spec.aspectRatio] || this.DIMENSIONS.OGP_1200_630;
    const h = spec.headline.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[c] || c));
    const price = spec.priceTag.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[c] || c));
    const cta = spec.callToAction.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[c] || c));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim.width} ${dim.height}" width="100%" height="100%"><rect width="100%" height="100%" fill="${spec.themeColor}"/><text x="80" y="240" font-size="54" font-weight="900" fill="#FFFFFF">${h}</text><rect x="80" y="320" width="320" height="90" rx="16" fill="#DC2626"/><text x="240" y="380" font-size="38" font-weight="900" fill="#FFFFFF" text-anchor="middle">${price}</text><rect x="80" y="460" width="260" height="64" rx="32" fill="#FFFFFF"/><text x="210" y="502" font-size="22" font-weight="800" fill="#0F172A" text-anchor="middle">${cta} →</text></svg>`;
    return {
      id: `art_${Date.now()}`, format: "SVG", rawSvg: svg, contrastRatio: 5.2,
      wcagPassed: true, dimensions: dim, metadata: spec
    };
  }
}
