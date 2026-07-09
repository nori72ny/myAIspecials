import { globalEventBus } from '../../kernel/events/EventBus';
import { Goal } from '../domain/entities/Goal';
import { Intent } from '../domain/entities/Intent';
import { ProposedMission } from '../domain/entities/ProposedMission';
import {
  IGoalParserPlugin,
  IIntentAnalyzerPlugin,
  IGoalValidatorPlugin,
  IGoalContextBuilderPlugin,
  IGoalPlannerPlugin
} from '../interfaces/types';
import { PluginRegistry } from '../../kernel/plugin/PluginRegistry';

export class GoalEngine {
  private goals: Map<string, Goal> = new Map();

  constructor(
    private pluginRegistry: PluginRegistry,
    private parser: IGoalParserPlugin,
    private contextBuilder: IGoalContextBuilderPlugin,
    private analyzer: IIntentAnalyzerPlugin,
    private validator: IGoalValidatorPlugin,
    private planner: IGoalPlannerPlugin
  ) {
    this.setupSubscriptions();
  }

  private setupSubscriptions(): void {
    globalEventBus.subscribe('GoalSubmitted', this.handleGoalSubmitted.bind(this));
  }

  /**
   * Externally submit a goal to the system.
   */
  public async submitGoal(rawInput: string, userId: string): Promise<string> {
    const goalId = `goal-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Publish GoalSubmitted event
    await globalEventBus.publish('GoalSubmitted', {
      eventId: `evt-${Date.now()}`,
      timestamp: Date.now(),
      goalId,
      rawInput,
      userId
    });

    return goalId;
  }

  private async handleGoalSubmitted(payload: any): Promise<void> {
    const { goalId, rawInput, userId } = payload;
    
    const goal = new Goal(goalId, rawInput, userId, "pending");
    this.goals.set(goalId, goal);

    try {
      // 1. Parsing
      const parsedData = await this.parser.parse(rawInput);
      
      // 2. Context Building
      goal.updateStatus("clarifying");
      const userContext = await this.contextBuilder.buildContext(userId);

      // 3. Intent Analysis
      const intent = await this.analyzer.analyze(goal, userContext);

      // 4. Validation
      const validationResult = await this.validator.validate(intent);
      if (!validationResult.valid) {
        throw new Error(`Goal validation failed: ${validationResult.reasons.join(', ')}`);
      }

      // Publish IntentClarified
      await globalEventBus.publish('IntentClarified', {
        eventId: `evt-${Date.now()}`,
        timestamp: Date.now(),
        goalId: goal.id,
        intent: {
          clarifiedObjective: intent.clarifiedObjective,
          targetAudience: intent.targetAudience,
          constraints: intent.constraints
        }
      });

      // 5. Strategy Formulation (Planning)
      goal.updateStatus("formulating");
      const missions = await this.planner.plan(intent);

      // Publish MissionsProposed
      await globalEventBus.publish('MissionsProposed', {
        eventId: `evt-${Date.now()}`,
        timestamp: Date.now(),
        goalId: goal.id,
        proposedMissions: missions.map(m => ({
          missionId: m.missionId,
          title: m.title,
          description: m.description,
          order: m.order
        }))
      });

      goal.updateStatus("executing");
    } catch (error) {
      console.error(`[GoalEngine] Failed to process goal ${goalId}:`, error);
      goal.updateStatus("failed");
    }
  }

  public getGoal(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }
}
