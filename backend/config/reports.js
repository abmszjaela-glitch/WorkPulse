import './environment.js';
export function loadReportConfig(){
  const number=(key,fallback)=>{const value=Number(process.env[key]||fallback);if(!Number.isInteger(value)||value<1||value>10000)throw new Error(`Invalid ${key}`);return value;};
  return {maxCsvRows:number('REPORT_CSV_MAX_ROWS',10000),maxPdfRows:number('REPORT_PDF_MAX_ROWS',2000),fontPath:process.env.REPORT_FONT_PATH||null};
}
