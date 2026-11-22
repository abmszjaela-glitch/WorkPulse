import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {hashPassword} from '../services/passwords.js';

test('migration 002 backfills an existing bootstrapped Admin profile without changing credentials',async()=>{
  const db=new PGlite(),id=randomUUID(),email='migration-fixture@example.test';
  try{
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../migrations/001_auth.proposed.sql',import.meta.url),'utf8'));
    const hash=await hashPassword('Synthetic-password-123!',10);
    await db.query('select wp_auth_bootstrap_admin($1,$2,$3)',[id,email,hash]);
    const preflight=await readFile(new URL('../setup/profile-preflight.sql',import.meta.url),'utf8');
    const before=await db.exec(preflight);assert.ok(before.every(result=>result.rows.length===0));
    await db.exec(await readFile(new URL('../migrations/002_core_management.proposed.sql',import.meta.url),'utf8'));
    await db.exec('set role service_role');
    const profile=(await db.query("select wp_core_profile($1,'get','{}') as profile",[id])).rows[0].profile;
    assert.equal(profile.id,id);assert.equal(profile.first_name,'');assert.equal(profile.role,'A');
    const user=(await db.query('select email,password_hash,role from wp_auth_users where id=$1',[id])).rows[0];
    assert.equal(user.password_hash===hash,true);assert.equal(user.email,email);assert.equal(user.role,'A');
    await db.query("select wp_core_profile($1,'update',$2)",[id,JSON.stringify({firstName:'Saved',lastName:'Admin',phone:'+94112345678',language:'si',timezone:'Asia/Colombo'})]);
    const saved=(await db.query("select wp_core_profile($1,'get','{}') as profile",[id])).rows[0].profile;
    assert.equal(saved.first_name,'Saved');assert.equal(saved.phone,'+94112345678');
    assert.equal((await db.query('select count(*) as n from wp_employee_profiles')).rows[0].n,1);
  }finally{await db.close();}
});
