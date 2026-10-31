/** CSS Modules are inlined by the tsdown build; this declares their shape to tsc. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
