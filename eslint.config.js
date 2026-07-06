const {FlatCompat} = require("@eslint/eslintrc");
const btrzBase = require("eslint-config-btrz-base");

const compat = new FlatCompat({
  baseDirectory: __dirname
});

module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        Buffer: "readonly",
        __dirname: "readonly",
        console: "readonly",
        module: "readonly",
        process: "readonly",
        require: "readonly"
      }
    }
  },
  ...compat.config(btrzBase.configs.all)
];
