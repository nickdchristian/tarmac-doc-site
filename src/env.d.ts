/// <reference types="astro/client" />

declare module 'virtual:starlight/user-config' {
  const config: {
    pagefind?: boolean;
    components: Record<string, string>;
  };
  export default config;
}

declare module 'virtual:starlight/components/Search' {
  const Search: any;
  export default Search;
}
