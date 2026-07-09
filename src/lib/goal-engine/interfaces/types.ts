import { Goal } from '../domain/entities/Goal';
import { Intent } from '../domain/entities/Intent';
import { ProposedMission } from '../domain/entities/ProposedMission';
import { IPlugin } from '../../kernel/plugin/types';

export interface UserContext {
  userId: string;
  preferences: Record<string, any>;
  history: string[];
}

export interface IGoalParserPlugin extends IPlugin {
  parse(rawInput: string): Promise<{ parsedObjective: string; initialTags: string[] }>;
}

export interface IIntentAnalyzerPlugin extends IPlugin {
  analyze(goal: Goal, context: UserContext): Promise<Intent>;
}

export interface IGoalValidatorPlugin extends IPlugin {
  validate(intent: Intent): Promise<{ valid: boolean; reasons: string[] }>;
}

export interface IGoalContextBuilderPlugin extends IPlugin {
  buildContext(userId: string): Promise<UserContext>;
}

export interface IGoalPlannerPlugin extends IPlugin {
  plan(intent: Intent): Promise<ProposedMission[]>;
}
