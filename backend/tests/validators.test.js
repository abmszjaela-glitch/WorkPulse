import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCore,text} from '../middleware/core-validation.js';
import {monitoringSettings,schedule} from '../validators/settings.js';
import {reportFilters,validateDateRange} from '../validators/report-filters.js';
import {employeeCreate,deviceRegistration} from '../validators/management.js';

const check=(schema,body={},query={})=>{
  const req={body,query,params:{}};let called=false;
  validateCore(schema,{nonEmptyBody:!!schema.body})(req,{},()=>{called=true;});assert.equal(called,true);return req;
};
test('settings validators accept real section fields and reject incorrect types/ranges/extra fields',()=>{
  check({body:monitoringSettings},{idleMinutes:5,evaluationSeconds:60,syncMinutes:5,trackApplications:true});
  for(const body of [{idleMinutes:'5'},{idleMinutes:31},{evaluationSeconds:7},{unexpected:true},{}])assert.throws(()=>check({body:monitoringSettings},body),{status:400});
});
test('report filters reject incorrect dates, IDs and reversed ranges',()=>{
  const req=check({query:reportFilters},{},{from:'2026-11-01',to:'2026-11-20',page:'1'});validateDateRange(req,{},()=>{});
  for(const query of [{from:'2026-02-31'},{employeeId:'invalid'},{page:'0'}])assert.throws(()=>check({query:reportFilters},{},query),{status:400});
  const reversed=check({query:reportFilters},{},{from:'2026-11-20',to:'2026-11-01'});assert.throws(()=>validateDateRange(reversed,{},()=>{}),{status:400});
});
test('employee/device validators enforce required fields and sanitize appropriate strings',()=>{
  assert.throws(()=>check({body:employeeCreate},{email:'invalid'}),{status:400});
  assert.throws(()=>check({body:deviceRegistration},{name:'PC',platform:'Windows'}),{status:400});
  assert.equal(text(20)('  Cafe\u0301  '),'Café');assert.throws(()=>text(20)('unsafe\0text'),{status:400});
});
test('working-hours validation supports overnight shifts and rejects malformed schedules',()=>{
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const rows=days.map(day=>({day,enabled:true,start:'22:00',end:'06:00'}));assert.equal(schedule(rows).length,7);
  assert.throws(()=>schedule(rows.slice(1)),{status:400});assert.throws(()=>schedule(rows.map(row=>({...row,end:'99:00'}))),{status:400});
});
