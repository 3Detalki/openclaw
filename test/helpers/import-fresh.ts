export async function importFreshModule<TModule>(
  from: string,
  specifier: string,
): Promise<TModule> {
  return (await import(/* @vite-ignore */ new URL(specifier, from).href)) as TModule;
}
