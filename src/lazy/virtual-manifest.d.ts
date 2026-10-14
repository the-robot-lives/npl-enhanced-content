/**
 * The build-time manifests the lazy builds inject (scripts/build.mjs, the
 * `semtext-manifest` / `npl-manifest` inline plugins): tag → chunk path
 * relative to dist/ (`chunks/…` for semtext-lazy, `npl-chunks/…` for
 * npl-lazy). There is no source file to resolve — vite serves them
 * virtually, and these declarations keep `tsc --noEmit` honest about the
 * shape. Unit specs never import the real ones; the vitest aliases point
 * the specifiers at stubs (test/unit/fixtures/).
 */
declare module 'virtual:semtext-manifest' {
  const manifest: Record<string, string>;
  export default manifest;
}

declare module 'virtual:npl-manifest' {
  const manifest: Record<string, string>;
  export default manifest;
}
