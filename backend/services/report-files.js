import PDFDocument from 'pdfkit';
import {createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import {once} from 'node:events';
import {csv} from '../utils/csv.js';

export const reportColumns={
  summary:[['Employee','employee_name'],['Employee code','employee_code'],['Email','email'],['Department','department_name'],['Role','role'],
    ['Monitored seconds','total_monitored_seconds'],['Active seconds','active_seconds'],['Idle seconds','idle_seconds'],['Productive app seconds','productive_seconds'],
    ['Neutral app seconds','neutral_seconds'],['Unproductive app seconds','unproductive_seconds'],['Unclassified app seconds','unclassified_seconds'],
    ['Productivity score (unavailable)','productivity_score'],['Observed activity days','observed_activity_days'],['Top application','top_application']],
  activity:[['Employee','employee_name'],['Department','department_name'],['Record ID','record_id'],['Interval start','interval_start'],['Interval end','interval_end'],
    ['Monitored seconds','total_monitored_seconds'],['Active seconds','active_seconds'],['Idle seconds','idle_seconds'],['Interval overlap fraction','interval_fraction']],
  'application-usage':[['Employee','employee_name'],['Department','department_name'],['Application','application_name'],['Category','category'],['Duration seconds','duration_seconds']],
};
export async function writeReportCsv(path,report){
  const columns=reportColumns[report.meta.reportType],output=createWriteStream(path,{mode:0o600});const done=finished(output);
  const header=csv([],columns);
  try{if(!output.write(header))await once(output,'drain');
    for(const row of report.data){if(!output.write(csv([row],columns).slice(header.length)))await once(output,'drain');}
    output.end();await done;
  }catch(error){output.destroy();await done.catch(()=>{});throw error;}
}
const duration=value=>{const seconds=Math.round(Number(value)||0);return `${Math.floor(seconds/3600)}h ${String(Math.floor(seconds%3600/60)).padStart(2,'0')}m ${String(seconds%60).padStart(2,'0')}s`;};
export async function writeReportPdf(path,report,{fontPath}={}){
  const doc=new PDFDocument({size:'A4',layout:'landscape',margins:{top:36,left:40,right:40,bottom:38},bufferPages:true,
    info:{Title:'WorkPulse Monitoring Report',Author:'WorkPulse'}});
  const output=createWriteStream(path,{mode:0o600}),done=finished(output);doc.on('error',error=>output.destroy(error));doc.pipe(output);
  try{
    if(fontPath)doc.font(fontPath);
    const width=doc.page.width-80,left=40;
    const kind=report.meta.reportType;
    const columns=kind==='summary'?[['Employee','employee_name'],['Department','department_name'],['Monitored','total_monitored_seconds'],['Active','active_seconds'],['Idle','idle_seconds'],['Observed days','observed_activity_days']]
      :kind==='activity'?[['Employee','employee_name'],['Interval start','interval_start'],['Interval end','interval_end'],['Active','active_seconds'],['Idle','idle_seconds']]
      :[['Employee','employee_name'],['Department','department_name'],['Application','application_name'],['Category','category'],['Seconds','duration_seconds']];
    const widths=columns.map((_,index)=>width*(index===0?0.25:0.75/(columns.length-1)));
    let y;
    function pageHeader(first){
      doc.fillColor('#172554').fontSize(first?22:15).text('WorkPulse Monitoring Report',left,30,{width,lineBreak:false});
      doc.fontSize(9).fillColor('#475569').text(`${report.meta.from} to ${report.meta.to} | ${report.meta.timezone} | ${kind}`,left,first?61:54,{width});
      doc.text(`Generated: ${report.meta.generatedAt}`,left,first?77:68,{width});
      doc.text(`Employee: ${report.scope?.employee||'All permitted employees'} | Department: ${report.scope?.department||'All permitted departments'}`,left,first?93:82,{width});
      y=first?118:108;
      if(first){const k=report.kpis||{};
        doc.fontSize(10).fillColor('#172554').text(`Monitored: ${duration(k.total_monitored_seconds)}    Active: ${duration(k.active_seconds)}    Idle: ${duration(k.idle_seconds)}`,left,y,{width});y+=19;
        doc.fontSize(8).fillColor('#64748b').text('Productivity score / attendance / overtime: unavailable (business rules not approved). Device time; boundary intervals prorated.',left,y,{width});y+=26;
      }
      doc.rect(left,y,width,24).fill('#eff6ff');let x=left;
      columns.forEach(([title],i)=>{doc.fillColor('#172554').fontSize(8).text(title,x+6,y+7,{width:widths[i]-12,lineBreak:false});x+=widths[i];});y+=24;
    }
    pageHeader(true);
    if(!report.data.length){doc.fontSize(11).fillColor('#64748b').text('No report rows match the authorized filters.',left,y+18,{width});}
    report.data.forEach((row,index)=>{
      const cells=columns.map(([,key])=>key.endsWith('_seconds')&&key!=='duration_seconds'?duration(row[key]):String(row[key]??'—'));
      doc.fontSize(8);
      const height=Math.max(28,...cells.map((cell,i)=>doc.heightOfString(cell,{width:widths[i]-12})+14));
      if(y+height>doc.page.height-52){doc.addPage();pageHeader(false);}
      if(index%2===0)doc.rect(left,y,width,height).fill('#f8fafc');
      let x=left;cells.forEach((cell,i)=>{doc.fillColor('#1e293b').fontSize(8).text(cell,x+6,y+7,{width:widths[i]-12,height:height-10});x+=widths[i];});
      y+=height;doc.strokeColor('#e2e8f0').moveTo(left,y).lineTo(left+width,y).stroke();
    });
    const pages=doc.bufferedPageRange();for(let i=pages.start;i<pages.start+pages.count;i++){doc.switchToPage(i);
      const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
      doc.fontSize(8).fillColor('#64748b').text(`WorkPulse | ${i+1} / ${pages.count}`,left,doc.page.height-26,{width,align:'right',lineBreak:false});
      doc.page.margins.bottom=bottom;}
    doc.end();await done;
  }catch(error){doc.destroy();output.destroy();await done.catch(()=>{});throw error;}
}
