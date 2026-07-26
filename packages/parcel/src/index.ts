export interface ParcelAdapterOptions {
  readonly strict?: boolean;
  readonly injectRuntime?: boolean;
}

export interface ParcelIntegrationSurface {
  readonly cssTransformer: "required";
  readonly htmlTransformer: "required-for-automatic-exact-one";
  readonly developmentAssets: "required";
}
