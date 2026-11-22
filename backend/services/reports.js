import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ApiError} from '../utils/api-error.js';
import {loadProcessingConfig} from '../config/processing.js';
import {loadMonitoringConfig} from '../config/monitoring.js';
import {loadReportConfig} from '../config/reports.js';
import {writeReportCsv,writeReportPdf} from './report-files.js';

export function createReportService({client,timezone=loadProcessingConfig().timezone,config=loadReportConfig()}){
  const offlineTimeoutSeconds=loadMonitoringConfig().offlineTimeoutSeconds;
  async function rpc(name,args){const {data,error}=await client.rpc(name,args);if(error){if(/^PT(400|401|403|404|409|413)$/.test(error.code))throw new ApiError(Number(error.code.slice(2)),error.message);
    throw new ApiError(503,'Reporting storage unavailable');}return data;}
  function period(kind,input){const zone=input.timezone||timezone;
    const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
    const to=input.to||`${p.year}-${p.month}-${p.day}`;
    const from=input.from||(kind==='daily'?to:kind==='monthly'?to.slice(0,8)+'01':new Date(Date.parse(to)-6*86400000).toISOString().slice(0,10));
    if(from>to||(Date.parse(to)-Date.parse(from))/86400000>366)throw new ApiError(400,'Invalid or excessive report period');
    return {...input,from,to,timezone:zone,reportType:input.reportType||'summary',offlineTimeoutSeconds};}
  async function query(actor,kind,input={},action='rows'){
    const options=period(kind,input);const result=await rpc('wp_reports',{p_actor:actor.userId,p_session:actor.sessionId,p_action:action,p_options:options});
    return {success:true,message:'Report generated',...result,meta:{...options,generatedAt:new Date().toISOString(),productivity_score:null}};
  }
  return {query,
    async export(actor,type,input){
      const limit=type==='pdf'?config.maxPdfRows:config.maxCsvRows;
      const report=await query(actor,'weekly',{...input,maxRows:limit},'export');
      const id=randomUUID(),filename=`WorkPulse-${report.meta.reportType}-${id}.${type}`;
      const directory=await mkdtemp(join(tmpdir(),'workpulse-report-')),path=join(directory,filename);
      try{
        if(type==='pdf')await writeReportPdf(path,report,config);else await writeReportCsv(path,report);
        const bytes=(await stat(path)).size,hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
        await rpc('wp_report_export_record',{p_actor:actor.userId,p_data:{id,type,reportType:report.meta.reportType,from:report.meta.from,to:report.meta.to,
          timezone:report.meta.timezone,filename,bytes,sha256:hash.digest('hex'),rowCount:report.data.length,employeeIds:[...new Set(report.data.map(row=>row.employee_id))]}});
        return {path,filename,cleanup:()=>rm(directory,{recursive:true,force:true})};
      }catch(error){await rm(directory,{recursive:true,force:true});if(error instanceof ApiError)throw error;throw new ApiError(503,'Report file generation unavailable');}
    },
  };
}
