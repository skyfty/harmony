module.exports = {
  // Force standard CSS parser to avoid accidental use of non-standard syntaxes
  // that can choke on valid CSS (e.g., CSS variables like var(--x)).
  parser: require('postcss-safe-parser'),
  plugins: [
    // Keep it minimal for H5 dev. Autoprefixer is optional; uncomment if needed.
    // require('autoprefixer')(),
  ],
};
