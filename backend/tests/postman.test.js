import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Postman covers all documented requests without embedding credentials',async()=>{
 const load=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
 const manifest=await load('reports/api-document-manifest.json'),collection=await load('postman/WorkPulse.postman_collection.json'),environment=await load('postman/WorkPulse.postman_environment.json');
 const requests=collection.item.filter(folder=>!folder.name.startsWith('RBAC')).flatMap(folder=>folder.item);
 assert.equal(requests.length,99);
 assert.deepEqual(requests.map(x=>x.name).sort(),manifest.endpoints.map(e=>e.method+' '+e.path).sort());
 for(const item of requests){assert.ok(item.request.url.startsWith('{{baseUrl}}/'));if(item.request.body)assert.doesNotThrow(()=>JSON.parse(item.request.body.raw));}
 for(const key of ['adminToken','managerToken','employeeToken','agentToken','loginPassword','refreshToken','deviceCredential'])assert.equal(environment.values.find(x=>x.key===key).value,'');
});
