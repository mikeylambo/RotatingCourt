/// <reference types="vite/client" />
declare module "virtual:art-sprites" {
  /** File names found in public/art/ at build time. */
  const files: string[];
  export default files;
}
