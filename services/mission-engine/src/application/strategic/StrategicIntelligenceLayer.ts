import { OrganizationState } from "../organization/OrganizationTypes";
import { FuturePredictionEngine } from "./FuturePredictionEngine";
import { SimulationEngine } from "./SimulationEngine";
import { ScenarioPlanner } from "./ScenarioPlanner";
import { CorporateGoalManager } from "./CorporateGoalManager";
import { RiskIntelligenceEngine } from "./RiskIntelligenceEngine";
import { InnovationEngine } from "./InnovationEngine";
import { DecisionIntelligence } from "./DecisionIntelligence";
import { OrganizationDigitalTwin } from "./OrganizationDigitalTwin";
import { 
  Prediction, SimulationPlan, Scenario, CorporateGoal, 
  RiskMission, InnovationProposal, StrategicDecision 
} from "./StrategicTypes";

export class StrategicIntelligenceLayer {
  private predictionEngine: FuturePredictionEngine;
  private simulationEngine: SimulationEngine;
  private scenarioPlanner: ScenarioPlanner;
  private goalManager: CorporateGoalManager;
  private riskEngine: RiskIntelligenceEngine;
  private innovationEngine: InnovationEngine;
  private decisionIntelligence: DecisionIntelligence;
  private digitalTwin: OrganizationDigitalTwin;

  private static instance: StrategicIntelligenceLayer;

  private constructor() {
    this.predictionEngine = new FuturePredictionEngine();
    this.simulationEngine = new SimulationEngine();
    this.scenarioPlanner = new ScenarioPlanner();
    this.goalManager = CorporateGoalManager.getInstance();
    this.riskEngine = new RiskIntelligenceEngine();
    this.innovationEngine = new InnovationEngine();
    this.decisionIntelligence = new DecisionIntelligence();
    this.digitalTwin = new OrganizationDigitalTwin();
  }

  public static getInstance(): StrategicIntelligenceLayer {
    if (!StrategicIntelligenceLayer.instance) {
      StrategicIntelligenceLayer.instance = new StrategicIntelligenceLayer();
    }
    return StrategicIntelligenceLayer.instance;
  }

  public getFullIntelligence(state: OrganizationState, currentMissionPrompt: string) {
    return {
      prediction: this.predictionEngine.generatePrediction(state),
      simulations: this.simulationEngine.simulatePlans(currentMissionPrompt, state),
      scenarios: this.scenarioPlanner.generateScenarios(currentMissionPrompt),
      goals: this.goalManager.getGoals(),
      alignmentScore: this.goalManager.calculateAlignmentScore(currentMissionPrompt),
      risks: this.riskEngine.generateRiskMissions(state),
      innovations: this.innovationEngine.generateProposals(),
      decisions: this.decisionIntelligence.generateDecisions() };
  }

  public startAutonomousCycle(stateRef: () => OrganizationState, intervalMs: number = 60000) {
    setInterval(() => {
      const state = stateRef();
      const intelligence = this.getFullIntelligence(state, "Autonomous cycle analysis");
      console.log(`[SIL] Autonomous Cycle Executed. Alignment: ${intelligence.alignmentScore}, Risks: ${intelligence.risks.length}, Innovations: ${intelligence.innovations.length}`);
    }, intervalMs);
  }
}
