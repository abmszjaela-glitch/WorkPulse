import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkProfileStorage} from '../services/profile-readiness.js';

function client(tableResult,rpcError={code:'PT403'}){
  return {from:()=>({select:()=>({limit:async n=>{assert.equal(n,0);return tableResult;}})}),rpc:async(name,args)=>{
    assert.equal(name,'wp_core_profile');assert.deepEqual(args,{p_actor:null,p_action:'get',p_data:{}});return {error:rpcError};
  }};
}
test('HEAD-like empty success is not treated as an available profile table',async()=>{
  const result=await checkProfileStorage(client({data:null,error:null,status:204}));
  assert.equal(result.ready,false);assert.ok(result.checks.slice(0,3).every(check=>!check.ready));
});
test('missing profile function fails readiness even if table reads work',async()=>{
  const result=await checkProfileStorage(client({data:[],error:null},{code:'PGRST202'}));
  assert.equal(result.ready,false);assert.equal(result.checks.at(-1).code,'PGRST202');
});
test('verified zero-row GETs and expected authorization rejection indicate readiness',async()=>{
  assert.equal((await checkProfileStorage(client({data:[],error:null}))).ready,true);
});
