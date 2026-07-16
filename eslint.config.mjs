import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          // packages/db and packages/core are TS-source-only libs (their
          // "build" target only emits .d.ts, per tsconfig.lib.json's
          // emitDeclarationOnly — see A4/B2 task reports): workspace
          // consumers resolve them straight from `src/index.ts` via
          // package.json `exports`, not from a compiled JS `dist`. That's
          // an intentional, source-linked monorepo architecture, not an
          // oversight — so the "importer must itself be non-buildable, or
          // the imported lib must have a JS build" constraint this flag
          // enforces doesn't apply here (apps/cli, the first buildable
          // consumer of a workspace lib, would otherwise be blocked from
          // importing packages/core).
          enforceBuildableLibDependency: false,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
