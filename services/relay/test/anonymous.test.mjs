import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRelay} from '../src/server.mjs';

test('Relay startup requires an account gateway, including after upgrading anonymous installations',()=>{
  for(const options of [{}, {admission:{}}, {gateway:{}}])
    assert.throws(()=>createRelay({origin:'https://relay.example.org',...options}),/Account gateway required/);
});
