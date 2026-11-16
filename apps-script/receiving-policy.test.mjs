import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("./รหัส.js",import.meta.url),"utf8");
const sandbox={console};
vm.runInNewContext(source+"\n;globalThis._policy=receivingOverageWithinTolerance_;",sandbox);
const accepted=(delta,ordered)=>sandbox._policy(delta,ordered);

test("any shortage is reportable even when smaller than 3kg",()=>{
  assert.equal(accepted(-0.1,100),false);
  assert.equal(accepted(-3,100),false);
});
test("overage of exactly 3 percent is accepted; above is reportable",()=>{
  assert.equal(accepted(3,100),true);
  assert.equal(accepted(3.001,100),false);
  assert.equal(accepted(2.5,70),false);
});
test("zero reference with positive receipt is an overage issue",()=>{
  assert.equal(accepted(1,0),false);
});
test("unknown delta means reported-only incident rather than accepted overage",()=>{
  assert.equal(accepted(null,null),false);
});
