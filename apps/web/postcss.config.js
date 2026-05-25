/**
 * Purpose: PostCSS pipeline for Tailwind CSS.
 * Input/Output: CSS source becomes browser-ready CSS.
 * Invariants: Tailwind runs before Autoprefixer.
 * Debugging: CSS build errors usually point to Tailwind config or invalid class names.
 */

export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
