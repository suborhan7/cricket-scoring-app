const test = require("node:test");
const assert = require("node:assert/strict");
const { check } = require("../js/emailcheck.js");

test("real-looking emails pass", () => {
  for (const e of ["rahim.khan@gmail.com", "Player123@Gmail.com", "x@mail.com", "someone@yahoo.com", "a.b@aiub.edu", "me@hotmail.co.uk", "club@czspl.org"]) assert.ok(check(e).ok, e);
});

test("bad Gmail names, typos and throwaway inboxes are stopped", () => {
  assert.equal(check("abc@gmail.com").ok, false);          // under 6 letters
  assert.equal(check("bad_name!@gmail.com").ok, false);
  assert.equal(check("rahim..khan@gmail.com").ok, false);
  assert.equal(check("rahimkhan@gmial.com").suggest, "rahimkhan@gmail.com");
  assert.equal(check("rahimkhan@gmail.con").suggest, "rahimkhan@gmail.com");
  assert.equal(check("rahimkhan@hotmial.com").suggest, "rahimkhan@hotmail.com");
  assert.equal(check("x@mailinator.com").ok, false);
  assert.equal(check("not an email").ok, false);
});
