import { describe, it, expect } from "vitest";
import { isProhibitedUrl, processTruthAndEvidence } from "../truthCalculator";

describe("Truth Engine & Evidence Scoring - Sprint 11-1 Unit Tests", () => {
  describe("isProhibitedUrl helper", () => {
    it("should block empty or invalid URL structures", () => {
      expect(isProhibitedUrl("")).toBe(true);
      expect(isProhibitedUrl("just_some_text")).toBe(true);
      expect(isProhibitedUrl("ftp://courts.go.jp")).toBe(true);
    });

    it("should block example.com and other prohibited domains", () => {
      expect(isProhibitedUrl("https://example.com/court")).toBe(true);
      expect(isProhibitedUrl("http://example.org/path")).toBe(true);
      expect(isProhibitedUrl("https://test.com/index")).toBe(true);
      expect(isProhibitedUrl("https://dummy.com")).toBe(true);
      expect(isProhibitedUrl("https://mock.com/api")).toBe(true);
      expect(isProhibitedUrl("https://localhost:3000")).toBe(true);
      expect(isProhibitedUrl("https://attacker.com/steal-data")).toBe(true);
    });

    it("should allow valid official and primary URLs", () => {
      expect(isProhibitedUrl("https://www.courts.go.jp/app/hanrei_jp/search1")).toBe(false);
      expect(isProhibitedUrl("https://www.nichibenren.or.jp/index.html")).toBe(false);
      expect(isProhibitedUrl("https://ai.google.dev/gemini-api/docs")).toBe(false);
      expect(isProhibitedUrl("https://platform.openai.com/docs")).toBe(false);
    });
  });

  describe("processTruthAndEvidence scoring engine", () => {
    it("should set TruthScore to 'Needs Review' if no citations are present", () => {
      const inputData = {
        evidenceEngine: {
          overallVerificationStatus: "Verified",
          averageAgreementRate: 95,
          verifications: [
            {
              claim: "Test claim without sources",
              category: "fact",
              aiAgreementRate: 100,
              sources: []
            }
          ]
        }
      };

      const result = processTruthAndEvidence(inputData);
      expect(result.mission.truthScore).toBeUndefined();
      expect(result.evidenceEngine.overallVerificationStatus).toBe("Needs Review");
      expect(result.mission.confidenceScore).toBe(0);
    });

    it("should filter out prohibited/dummy URLs and set status/TruthScore to 'Needs Review' if zero valid citations remain", () => {
      const inputData = {
        evidenceEngine: {
          overallVerificationStatus: "Verified",
          averageAgreementRate: 98,
          verifications: [
            {
              claim: "Supreme court success rate 95%",
              category: "fact",
              aiAgreementRate: 98,
              sources: [
                {
                  title: "Prohibited DB",
                  url: "https://example.com/court",
                  type: "primary",
                  reliabilityScore: 100
                }
              ]
            }
          ]
        }
      };

      const result = processTruthAndEvidence(inputData);
      // Valid sources list must be filtered to empty
      expect(result.evidenceEngine.verifications[0].sources.length).toBe(0);
      expect(result.mission.truthScore).toBeUndefined();
      expect(result.evidenceEngine.overallVerificationStatus).toBe("Needs Review");
    });

    it("should calculate correct programmatic TruthScore and Confidence based on valid citations", () => {
      const inputData = {
        evidenceEngine: {
          overallVerificationStatus: "Verified",
          averageAgreementRate: 90,
          verifications: [
            {
              claim: "Verified supreme court case",
              category: "fact",
              aiAgreementRate: 95,
              sources: [
                {
                  title: "Supreme Court DB",
                  url: "https://www.courts.go.jp/app/hanrei_jp/search1",
                  type: "primary",
                  reliabilityScore: 100
                }
              ]
            }
          ]
        }
      };

      const result = processTruthAndEvidence(inputData);
      expect(result.evidenceEngine.overallVerificationStatus).toBe("Verified");
      
      // Since we have valid citation:
      // totalCitations = 1
      // avgReliability = 100
      // avgAgreementRate = 95
      // TruthScore = Math.round(100 * 0.6 + 95 * 0.4) = Math.round(60 + 38) = 98
      expect(result.mission.truthScore).toBe(98);

      // ConfidenceScore = Math.round(100 * 0.5 + 95 * 0.3 + 1 * 5) = Math.round(50 + 28.5 + 5) = 84
      expect(result.mission.confidenceScore).toBe(84);
      expect(result.qualityEngine.confidence).toBe(84);
    });

    it("should set status/TruthScore to 'Needs Review' if average source reliability is below 60", () => {
      const inputData = {
        evidenceEngine: {
          overallVerificationStatus: "Verified",
          averageAgreementRate: 90,
          verifications: [
            {
              claim: "Unreliable citation claim",
              category: "fact",
              aiAgreementRate: 95,
              sources: [
                {
                  title: "Low quality source",
                  url: "https://www.nichibenren.or.jp/low-quality-blog",
                  type: "user",
                  reliabilityScore: 40
                }
              ]
            }
          ]
        }
      };

      const result = processTruthAndEvidence(inputData);
      expect(result.evidenceEngine.overallVerificationStatus).toBe("Needs Review");
      expect(result.mission.truthScore).toBeUndefined();
    });

    describe("Sprint 11-2 Evidence Engine requirements", () => {
      it("should hold and backfill fetchedAt, quote, and map type for each evidence source", () => {
        const inputData = {
          mission: {
            status: "Running"
          },
          evidenceEngine: {
            overallVerificationStatus: "Verified",
            averageAgreementRate: 95,
            verifications: [
              {
                claim: "Test sprint 11-2 claim",
                category: "fact",
                aiAgreementRate: 98,
                sources: [
                  {
                    title: "J-STAGE Academic Article",
                    url: "https://www.jstage.jst.go.jp/browse/-char/ja",
                    type: "paper"
                  }
                ]
              }
            ]
          }
        };

        const result = processTruthAndEvidence(inputData);
        const source = result.evidenceEngine.verifications[0].sources[0];
        
        // Evidenceごとに実URLを保持
        expect(source.url).toBe("https://www.jstage.jst.go.jp/browse/-char/ja");
        
        // 取得日時を保持
        expect(source.fetchedAt).toBeDefined();
        expect(typeof source.fetchedAt).toBe("string");
        
        // Source種別 (公式・論文・ニュース等) を保持
        expect(source.type).toBe("paper");
        
        // 引用箇所を保持
        expect(source.quote).toBeDefined();
        expect(typeof source.quote).toBe("string");
        expect(source.quote.length).toBeGreaterThan(0);
      });

      it("should put the Mission status into 'Needs Review' state if evidence is insufficient", () => {
        const inputData = {
          mission: {
            status: "Completed"
          },
          evidenceEngine: {
            overallVerificationStatus: "Verified",
            averageAgreementRate: 90,
            verifications: [
              {
                claim: "Claim with zero sources",
                category: "fact",
                aiAgreementRate: 95,
                sources: [] // no sources -> insufficient evidence
              }
            ]
          }
        };

        const result = processTruthAndEvidence(inputData);
        
        // Mission status must be changed to 'Needs Review'
        expect(result.mission.status).toBe("Needs Review");
        expect(result.mission.truthScore).toBeUndefined();
        expect(result.evidenceEngine.overallVerificationStatus).toBe("Needs Review");
      });

      it("should return 'Unverified' if a citation cannot be verified", () => {
        const inputData = {
          evidenceEngine: {
            overallVerificationStatus: "Verified",
            averageAgreementRate: 95,
            verifications: [
              {
                claim: "Test unverifiable claim",
                category: "fact",
                aiAgreementRate: 95,
                sources: [] // 0 sources
              }
            ]
          }
        };

        const result = processTruthAndEvidence(inputData);
        expect(result.evidenceEngine.verifications[0].status).toBe("Unverified");
      });
    });
  });
});
