export type UnpluginHost = "vite" | "rollup" | "rolldown" | "webpack" | "rspack" | "esbuild";

export interface UnpluginAdapterCapabilities {
  readonly host: UnpluginHost;
  readonly ownsHtml: boolean;
  readonly supportsDevelopmentAssets: boolean;
  readonly supportsHmr: boolean;
}

export interface UnpluginAdapterOptions {
  readonly strict?: boolean;
  readonly injectRuntime?: boolean;
}
