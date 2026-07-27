module.exports = () => ({
  postcssPlugin: "test-purge-capability-rules",
  OnceExit(root) {
    root.walkRules((rule) => {
      if (rule.selector.includes("data-imgcaps") || rule.selector === ".purge-me") {
        rule.remove();
      }
    });
  },
});

module.exports.postcss = true;
