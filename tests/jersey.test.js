const test = require("node:test");
const assert = require("node:assert/strict");
const J = require("../js/jersey.js");

test("card palette comes from the jersey colour; plain white kits borrow the trim", () => {
  const blue = J.vividPalette("#1d45a5", "#747884");
  assert.equal(blue.base, "#1d45a5");
  const white = J.vividPalette("#f5f5f5", "#e4572e");
  assert.notEqual(white.base.toLowerCase(), "#f5f5f5");
  assert.ok(J.luminance(white.deep) < 0.05);
});
