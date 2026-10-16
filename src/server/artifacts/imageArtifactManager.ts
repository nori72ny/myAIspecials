import { ArtifactDesignStudio, BannerAdSpec } from "./artifactDesignStudio";
export class ImageArtifactManager {
  public async createAndPersistBanner(userId: string, spec: BannerAdSpec) {
    let attempt = 0;
    while (attempt < 3) {
      attempt++;
      try {
        const artifact = ArtifactDesignStudio.generateAdBanner(spec);
        const base64 = Buffer.from(artifact.rawSvg).toString("base64");
        return {
          id: artifact.id, userId, prompt: spec.headline,
          storageUrl: `data:image/svg+xml;base64,${base64}`,
          format: artifact.format, createdAt: new Date().toISOString()
        };
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt + Math.random() * 500));
      }
    }
    throw new Error("HTTP 503 sustained.");
  }
}
