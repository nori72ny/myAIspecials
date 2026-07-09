import {
  IPlugin,
  IAIProviderPlugin,
  IToolPlugin,
  IMemoryPlugin,
  IWorkflowPlugin,
  IUIPlugin
} from "./types";

export class PluginRegistry {
  private plugins: Map<string, IPlugin> = new Map();
  private aiProviders: Map<string, IAIProviderPlugin> = new Map();
  private toolPlugins: Map<string, IToolPlugin> = new Map();
  private memoryPlugins: Map<string, IMemoryPlugin> = new Map();
  private workflowPlugins: Map<string, IWorkflowPlugin> = new Map();
  private uiPlugins: Map<string, IUIPlugin> = new Map();

  /**
   * Register a plugin into the Core System.
   * This respects Open/Closed principle: Core does not need to know concrete types.
   */
  public async registerPlugin(plugin: IPlugin): Promise<void> {
    if (this.plugins.has(plugin.manifest.id)) {
      throw new Error(`Plugin ${plugin.manifest.id} is already registered.`);
    }

    await plugin.initialize();
    this.plugins.set(plugin.manifest.id, plugin);

    // Sort plugins into their respective capability registries based on type checking
    // In TypeScript, we can use structural typing or explicit type flags. 
    // Here we check for specific methods or manifest properties that define the plugin type.
    
    if (this.isAIProviderPlugin(plugin)) {
      this.aiProviders.set(plugin.manifest.id, plugin);
    }
    
    if (this.isToolPlugin(plugin)) {
      this.toolPlugins.set(plugin.manifest.id, plugin);
    }

    if (this.isMemoryPlugin(plugin)) {
      this.memoryPlugins.set(plugin.manifest.id, plugin);
    }

    if (this.isWorkflowPlugin(plugin)) {
      this.workflowPlugins.set(plugin.manifest.id, plugin);
    }

    if (this.isUIPlugin(plugin)) {
      this.uiPlugins.set(plugin.manifest.id, plugin);
    }
  }

  public async unregisterPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    await plugin.shutdown();
    this.plugins.delete(pluginId);
    this.aiProviders.delete(pluginId);
    this.toolPlugins.delete(pluginId);
    this.memoryPlugins.delete(pluginId);
    this.workflowPlugins.delete(pluginId);
    this.uiPlugins.delete(pluginId);
  }

  // Getters for routing and execution
  public getAIProviders(): IAIProviderPlugin[] {
    return Array.from(this.aiProviders.values());
  }

  public getToolPlugins(): IToolPlugin[] {
    return Array.from(this.toolPlugins.values());
  }

  public getMemoryPlugins(): IMemoryPlugin[] {
    return Array.from(this.memoryPlugins.values());
  }

  public getWorkflowPlugins(): IWorkflowPlugin[] {
    return Array.from(this.workflowPlugins.values());
  }

  public getUIPlugins(): IUIPlugin[] {
    return Array.from(this.uiPlugins.values());
  }

  // Type Guards
  private isAIProviderPlugin(plugin: IPlugin): plugin is IAIProviderPlugin {
    return 'generateText' in plugin && 'models' in (plugin.manifest as any);
  }

  private isToolPlugin(plugin: IPlugin): plugin is IToolPlugin {
    return 'executeTool' in plugin && 'tools' in (plugin.manifest as any);
  }

  private isMemoryPlugin(plugin: IPlugin): plugin is IMemoryPlugin {
    return 'save' in plugin && 'load' in plugin && 'storageType' in (plugin.manifest as any);
  }

  private isWorkflowPlugin(plugin: IPlugin): plugin is IWorkflowPlugin {
    return 'executeWorkflow' in plugin && 'engineType' in (plugin.manifest as any);
  }

  private isUIPlugin(plugin: IPlugin): plugin is IUIPlugin {
    return 'render' in plugin && 'mountPoint' in (plugin.manifest as any);
  }
}
