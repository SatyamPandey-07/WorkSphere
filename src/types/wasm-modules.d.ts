declare module "*.wasm.js" {
  const factory: (config: any) => Promise<any>;
  export default factory;
}

declare module "/pdf-verify.js" {
  const factory: (config: any) => Promise<any>;
  export default factory;
}
