declare const __DEV__: boolean
declare const __IS_FIREFOX__: boolean
/** Extension name, defined in packageJson.name */
declare const __NAME__: string

declare module '*.vue' {
  const component: any
  export default component
}
