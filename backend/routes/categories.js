import {Router} from 'express';
import {authenticate,authorize} from '../middleware/auth.js';
import {validateCore} from '../middleware/core-validation.js';
import {idParams} from '../validators/management.js';
import {categoryCreate,categoryFields,categoryFilters} from '../validators/categories.js';
import {createCategoryController} from '../controllers/category-controller.js';

export function createCategoryRouter({auth,service}){
  const root=Router(),router=Router(),controller=createCategoryController(service);
  router.use(authenticate(auth),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/lookup',authorize('Agent'),validateCore({}),controller.lookup);
  router.get('/',authorize('A','M'),validateCore({query:categoryFilters}),controller.list);
  router.post('/',authorize('A'),validateCore({body:categoryCreate}),controller.create);
  router.put('/:id',authorize('A'),validateCore({params:idParams,body:categoryFields},{nonEmptyBody:true}),controller.update);
  router.delete('/:id',authorize('A'),validateCore({params:idParams}),controller.remove);
  root.use('/app-categories',router);return root;
}
