// Test stub for `mathlive`. The real package registers a `<math-field>` custom
// element as an import side-effect, which is irrelevant to persistence tests and
// pulls heavy web-component code into jsdom. The RichContent components only use
// `import "mathlive";` for that side-effect, so an empty module is sufficient.
export {};