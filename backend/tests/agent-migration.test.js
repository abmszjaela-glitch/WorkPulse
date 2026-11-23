import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {hashPassword} from '../services/passwords.js';

test('review bundle upgrades existing core schema atomically, preserves accounts, and refuses duplicate deployment',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
    for(const name of ['001_auth','002_core_management'])await db.exec(await readFile(new URL('../migrations/'+name+'.proposed.sql',import.meta.url),'utf8'));
    await db.exec('set role service_role');
    await db.query("insert into wp_auth_users(id,email,password_hash,role) values(gen_random_uuid(),$1,$2,'E')",['migration-fixture@example.test',await hashPassword('Synthetic-Migration-123!',10)]);
    await db.exec('reset role'); // Deployment DDL is run as the database owner.
    const bundle=await readFile(new URL('../setup/AGENT_INTEGRATION_REVIEW.sql',import.meta.url),'utf8');
    await db.exec(bundle);
    assert.equal((await db.query('select count(*) from wp_auth_users')).rows[0].count,1);
    assert.ok((await db.query("select to_regclass('wp_activity_intervals') as present")).rows[0].present);
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='wp_activity_intervals'")).rows[0].relrowsecurity,true);
    await assert.rejects(db.exec(bundle),/later phase already exists/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*) from wp_auth_users')).rows[0].count,1);
  }finally{await db.close();}
});
