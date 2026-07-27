declare module "*.css";

declare module "*?worker" {
  const WorkerConstructor: {
    new (): Worker;
  };

  export default WorkerConstructor;
}

declare module "less/lib/less/index.js" {
  const createLess: (environment?: unknown, fileManagers?: readonly unknown[]) => unknown;

  export default createLess;
}

declare module "less/lib/less-browser/plugin-loader.js" {
  const PluginLoader: unknown;

  export default PluginLoader;
}

declare module "less/lib/less/default-options.js" {
  const defaultOptions: () => Readonly<Record<string, unknown>>;

  export default defaultOptions;
}
