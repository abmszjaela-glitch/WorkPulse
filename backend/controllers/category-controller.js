export const createCategoryController=service=>({
  list:async(req,res)=>res.json(await service.list(req.auth,req.input.query)),
  lookup:async(req,res)=>res.json(await service.lookup(req.auth)),
  create:async(req,res)=>res.status(201).json(await service.create(req.auth,req.input.body)),
  update:async(req,res)=>res.json(await service.update(req.auth,req.input.params.id,req.input.body)),
  remove:async(req,res)=>{await service.remove(req.auth,req.input.params.id);res.status(204).end();},
});
