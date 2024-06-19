import { Injectable, invariant, InstantiationService } from '@alilc/lowcode-shared';
import { ICodeRuntimeService } from './services/code-runtime';
import {
  IBoostsService,
  IExtensionHostService,
  type RenderAdapter,
  type IRenderObject,
} from './services/extension';
import { IPackageManagementService } from './services/package';
import { ISchemaService } from './services/schema';
import { ILifeCycleService, LifecyclePhase } from './services/lifeCycleService';
import { IComponentTreeModelService } from './services/model';
import type { AppOptions, RendererApplication } from './types';

@Injectable()
export class RendererMain<RenderObject> {
  private mode: 'development' | 'production' = 'production';

  private initOptions: AppOptions;

  private renderObject: RenderObject;

  private adapter: RenderAdapter<RenderObject>;

  constructor(
    @ICodeRuntimeService private codeRuntimeService: ICodeRuntimeService,
    @IPackageManagementService private packageManagementService: IPackageManagementService,
    @ISchemaService private schemaService: ISchemaService,
    @IExtensionHostService private extensionHostService: IExtensionHostService,
    @IComponentTreeModelService private componentTreeModelService: IComponentTreeModelService,
    @IBoostsService private boostsService: IBoostsService,
    @ILifeCycleService private lifeCycleService: ILifeCycleService,
  ) {
    this.lifeCycleService.when(LifecyclePhase.OptionsResolved).then(async () => {
      const renderContext = {
        schema: this.schemaService,
        packageManager: this.packageManagementService,
        boostsManager: this.boostsService,
        componentTreeModel: this.componentTreeModelService,
        lifeCycle: this.lifeCycleService,
      };

      this.renderObject = await this.adapter(renderContext);

      this.lifeCycleService.phase = LifecyclePhase.Ready;
    });
  }

  async main(options: AppOptions, adapter: RenderAdapter<RenderObject>) {
    const { schema, mode, plugins = [] } = options;

    if (mode) this.mode = mode;
    this.initOptions = { ...options };
    this.adapter = adapter;

    // valid schema
    this.schemaService.initialize(schema);

    this.codeRuntimeService.initialize(options.codeRuntime ?? {});

    this.lifeCycleService.phase = LifecyclePhase.OptionsResolved;

    await this.lifeCycleService.when(LifecyclePhase.Ready);

    await this.extensionHostService.registerPlugin(plugins);

    await this.packageManagementService.loadPackages(this.initOptions.packages ?? []);

    this.lifeCycleService.phase = LifecyclePhase.AfterInitPackageLoad;
  }

  async getApp(): Promise<RendererApplication<RenderObject>> {
    await this.lifeCycleService.when(LifecyclePhase.AfterInitPackageLoad);

    // construct application
    return Object.freeze<RendererApplication<RenderObject>>({
      // develop use
      __options: this.initOptions,

      mode: this.mode,
      schema: this.schemaService,
      packageManager: this.packageManagementService,
      ...this.renderObject,

      use: (plugin) => {
        return this.extensionHostService.registerPlugin(plugin);
      },
    });
  }
}

/**
 * 创建 createRenderer 的辅助函数
 * @param schema
 * @param options
 * @returns
 */
export function createRenderer<RenderObject = IRenderObject>(
  renderAdapter: RenderAdapter<RenderObject>,
): (options: AppOptions) => Promise<RendererApplication<RenderObject>> {
  invariant(typeof renderAdapter === 'function', 'The first parameter must be a function.');

  const instantiationService = new InstantiationService({ defaultScope: 'Singleton' });
  instantiationService.bootstrapModules();

  const rendererMain = instantiationService.createInstance(
    RendererMain,
  ) as RendererMain<RenderObject>;

  return async (options) => {
    await rendererMain.main(options, renderAdapter);
    return rendererMain.getApp();
  };
}
