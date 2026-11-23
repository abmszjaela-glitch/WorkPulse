import {ApiError} from '../utils/api-error.js';
export function createReportController(service){
  return (kind,action='rows')=>async(req,res)=>{
    const filters={...req.input.query};
    for(const [name,value]of Object.entries(kind==='department'?{departmentId:req.input.params.id}:kind==='employee'?{employeeId:req.input.params.id}:{})){
      if(filters[name]&&filters[name]!==value)throw new ApiError(400,'Conflicting report scope');filters[name]=value;
    }
    if(action==='csv'||action==='pdf'){
      const file=await service.export(req.auth,action,filters);
      try{await new Promise((resolve,reject)=>res.download(file.path,file.filename,error=>error?reject(error):resolve()));}finally{await file.cleanup();}
    }else res.json(await service.query(req.auth,kind,filters,action));
  };
}
