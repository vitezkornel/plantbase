import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // `generated/` is the Prisma client (already gitignored, see root
    // .gitignore task A4 comment) — build output, not hand-written code.
    ignores: ['**/out-tsc', 'generated'],
  },
];
