import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJwtSecret,readServerKey} from '../config/credentials.js';

// Synthetic values here are isolated unit fixtures, never deployment credentials.
test('JWT configuration accepts the existing alias and canonical name',()=>{
 const value='a'.repeat(48);
 assert.equal(readJwtSecret({JWT_SECRET:value}),value);
 assert.equal(readJwtSecret({AUTH_JWT_SECRET:value}),value);
 assert.equal(readJwtSecret({AUTH_JWT_SECRET:value,JWT_SECRET:value}),value);
});
test('missing, weak and conflicting JWT configuration fails without exposing values',()=>{
 for(const input of [{},{JWT_SECRET:'short'},{AUTH_JWT_SECRET:' '.repeat(40)},{AUTH_JWT_SECRET:'a'.repeat(48),JWT_SECRET:'b'.repeat(48)}]){
  assert.throws(()=>readJwtSecret(input),error=>error.name==='ConfigurationError'&&!error.message.includes('a'.repeat(48)));
 }
});
test('backend never falls back to a publishable Supabase credential',()=>{
 for(const env of [{SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'},{SUPABASE_SECRET_KEY:'sb_publishable_fixture'},{SUPABASE_SECRET_KEY:'unrecognized-value'}])assert.throws(()=>readServerKey(env),{name:'ConfigurationError'});
 const anon='x.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.x';
 assert.throws(()=>readServerKey({SUPABASE_SECRET_KEY:anon}),{name:'ConfigurationError'});
});
test('server key guard supports both Supabase server credential formats',()=>{
 const legacy='x.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x';
 assert.equal(readServerKey({SUPABASE_SECRET_KEY:legacy}),legacy);
 assert.equal(readServerKey({SUPABASE_SECRET_KEY:'sb_secret_fixture'}),'sb_secret_fixture');
});
test('invalid startup exits before listening and reports only the missing variable',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{
  env:{...process.env,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'',SUPABASE_PUBLISHABLE_KEY:'must-not-be-used'},encoding:'utf8',timeout:10000,
 });
 assert.equal(result.status,1);assert.match(result.stderr,/Startup configuration error: Missing SUPABASE_SECRET_KEY/);
 assert.ok(!result.stdout.includes('listening'));assert.ok(!result.stderr.includes('must-not-be-used'));
});
