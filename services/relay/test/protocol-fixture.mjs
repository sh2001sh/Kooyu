import {createRelay as productionRelay} from "../src/server.mjs";

// The transport suites exercise framing and backpressure against a loopback peer.
export function createRelay(options) {
  if(new URL(options.origin).hostname!=="127.0.0.1") throw Error("Loopback fixture required");
  const claims={pairedClientId:"00000000-0000-4000-8000-000000000001",deviceId:"fixture"};
  return productionRelay({...options,gateway:{
    uplink:async()=>claims, access:async()=>claims, lease:async()=>{}, nonce:()=> "fixture",
  }});
}
